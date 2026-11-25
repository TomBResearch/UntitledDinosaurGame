package platform

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sync"
	"time"
)

// Account is an account's fresh state from the service API (GET /service/accounts/:id).
type Account struct {
	ID        string     `json:"id"`
	Username  string     `json:"username"`
	Role      Role       `json:"role"`
	Premium   bool       `json:"premium"`
	Banned    bool       `json:"banned"`
	BanEndsAt *time.Time `json:"banEndsAt"`
}

// HasPremium: Premium accounts, and staff (staff count as Premium, a platform rule).
func (a Account) HasPremium() bool { return a.Premium || a.Role.AtLeast(RolePremium) }

// ErrNoAccount means the platform has no such account (deleted, or never existed).
var ErrNoAccount = errors.New("platform: no such account")

// ErrUnavailable means the service API couldn't be reached or answered oddly. Callers answer 503:
// nothing that needs fresh state goes ahead without it.
var ErrUnavailable = errors.New("platform: service API unavailable")

// AccountSource gives an account's fresh state.
type AccountSource interface {
	Account(ctx context.Context, id string) (Account, error)
}

// Accounts is the service API client. Answers are cached for at most TTL (30 s, accounts.md), so a
// ban or a role change reaches us within that.
type Accounts struct {
	// BaseURL is the platform, for example http://accounts:3100 inside Docker.
	BaseURL string
	// Key is this game's service key (DINOSAUR_SERVICE_KEY). Never logged.
	Key  string
	HTTP *http.Client
	TTL  time.Duration
	Now  func() time.Time

	mu        sync.Mutex
	cache     map[string]cached
	nextPrune time.Time
}

type cached struct {
	acct Account
	at   time.Time
}

// NewAccounts makes a client with the defaults: a 30 s cache and a 5 s timeout.
func NewAccounts(baseURL, key string) *Accounts {
	return &Accounts{BaseURL: baseURL, Key: key, HTTP: &http.Client{Timeout: 5 * time.Second},
		TTL: 30 * time.Second, Now: time.Now}
}

// Account returns the account's fresh state.
func (a *Accounts) Account(ctx context.Context, id string) (Account, error) {
	if !ValidAccountID(id) {
		return Account{}, ErrNoAccount
	}
	now := a.Now()
	a.mu.Lock()
	if c, ok := a.cache[id]; ok && now.Sub(c.at) < a.TTL {
		a.mu.Unlock()
		return c.acct, nil
	}
	a.mu.Unlock()

	acct, err := a.fetch(ctx, id)
	if err != nil {
		return Account{}, err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cache == nil {
		a.cache = map[string]cached{}
	}
	if !now.Before(a.nextPrune) {
		for k, c := range a.cache {
			if now.Sub(c.at) >= a.TTL {
				delete(a.cache, k)
			}
		}
		a.nextPrune = now.Add(a.TTL)
	}
	a.cache[id] = cached{acct, now}
	return acct, nil
}

// Forget drops an account from the cache (the deletion hook, later).
func (a *Accounts) Forget(id string) {
	a.mu.Lock()
	delete(a.cache, id)
	a.mu.Unlock()
}

func (a *Accounts) fetch(ctx context.Context, id string) (Account, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.BaseURL+"/service/accounts/"+url.PathEscape(id), nil)
	if err != nil {
		return Account{}, fmt.Errorf("%w: %w", ErrUnavailable, err)
	}
	req.Header.Set("Authorization", "Service "+a.Key)
	resp, err := a.HTTP.Do(req)
	if err != nil {
		return Account{}, fmt.Errorf("%w: %w", ErrUnavailable, err)
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusOK:
	case http.StatusNotFound:
		return Account{}, ErrNoAccount
	default:
		return Account{}, fmt.Errorf("%w: HTTP %d", ErrUnavailable, resp.StatusCode)
	}
	var acct Account
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&acct); err != nil {
		return Account{}, fmt.Errorf("%w: %w", ErrUnavailable, err)
	}
	if acct.ID != id || !acct.Role.Valid() {
		return Account{}, fmt.Errorf("%w: unexpected answer", ErrUnavailable)
	}
	return acct, nil
}
