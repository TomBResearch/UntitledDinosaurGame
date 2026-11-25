package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/names"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/platform"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/ticket"
)

func (s *Server) health(w http.ResponseWriter, r *http.Request, _ *caller) {
	if err := s.cfg.Store.Ping(r.Context()); err != nil {
		s.cfg.Log.Error("database ping failed", "err", err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "unavailable", "version": s.cfg.Version})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "version": s.cfg.Version})
}

// worldJSON is one entry of GET /api/worlds. Population is null while the world is offline.
type worldJSON struct {
	ID          int     `json:"id"`
	Name        string  `json:"name"`
	PremiumOnly bool    `json:"premiumOnly"`
	Population  *string `json:"population"`
	Online      bool    `json:"online"`
}

func (s *Server) worlds(w http.ResponseWriter, r *http.Request, _ *caller) {
	worlds, err := s.cfg.Store.Worlds(r.Context())
	if err != nil {
		s.storeError(w, err)
		return
	}
	out := make([]worldJSON, len(worlds))
	var wg sync.WaitGroup
	for i, wd := range worlds {
		wg.Go(func() {
			players, online := s.cfg.Worlds.Status(r.Context(), wd.ID)
			out[i] = worldJSON{ID: wd.ID, Name: wd.Name, PremiumOnly: wd.PremiumOnly, Online: online}
			if online {
				p := Population(players, wd.MaxPlayers)
				out[i].Population = &p
			}
		})
	}
	wg.Wait()
	writeJSON(w, http.StatusOK, out)
}

// characterJSON is a character as the API shows it to its owner. combatLevel waits for open question
// C2 (M3); lastRegion and lastPlayedAt are null until persistence saves them.
type characterJSON struct {
	ID           string     `json:"id"`
	Name         string     `json:"name"`
	Slot         int        `json:"slot"`
	Appearance   Appearance `json:"appearance"`
	TotalLevel   int        `json:"totalLevel"`
	LastRegion   *string    `json:"lastRegion"`
	LastPlayedAt *time.Time `json:"lastPlayedAt"`
	Online       bool       `json:"online"`
	// NextRenameAt is when the character may next be renamed; null means now.
	NextRenameAt *time.Time `json:"nextRenameAt"`
}

func (s *Server) characterJSON(c Character, now time.Time) characterJSON {
	out := characterJSON{ID: c.ID, Name: c.Name, Slot: c.Slot, Appearance: c.Appearance, TotalLevel: s.totalLevel(c),
		LastPlayedAt: c.LastPlayedAt, Online: c.Online(now)}
	if c.Region != "" {
		out.LastRegion = &c.Region
	}
	if at := c.NextRename(now); !at.IsZero() {
		out.NextRenameAt = &at
	}
	return out
}

// totalLevel is the sum of the character's level in every skill in data/skills.json.
func (s *Server) totalLevel(c Character) int {
	total := 0
	for _, sk := range s.cfg.Data.Skills {
		total += s.cfg.Data.XP.LevelForXP(c.SkillXP[sk.ID])
	}
	return total
}

func (s *Server) listCharacters(w http.ResponseWriter, r *http.Request, who *caller) {
	chars, err := s.cfg.Store.Characters(r.Context(), who.claims.AccountID)
	if err != nil {
		s.storeError(w, err)
		return
	}
	now := s.cfg.Now()
	out := make([]characterJSON, len(chars))
	for i, c := range chars {
		out[i] = s.characterJSON(c, now)
	}
	writeJSON(w, http.StatusOK, out)
}

// nameError answers a name the rules refuse: 400 invalid_name, with a reason the client can show.
func nameError(w http.ResponseWriter, err error) {
	reason := "shape"
	switch {
	case errors.Is(err, names.ErrBlocked):
		reason = "not_allowed"
	case errors.Is(err, names.ErrReserved):
		reason = "reserved"
	}
	writeJSON(w, http.StatusBadRequest, apiError{Error: "invalid_name", Reason: reason})
}

func (s *Server) createCharacter(w http.ResponseWriter, r *http.Request, who *caller) {
	var req struct {
		Name       string      `json:"name"`
		Slot       int         `json:"slot"`
		Appearance *Appearance `json:"appearance"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	if req.Slot < 1 || req.Slot > Slots {
		writeError(w, http.StatusBadRequest, "invalid_slot")
		return
	}
	if err := s.cfg.Data.NameFilter.Check(req.Name); err != nil {
		nameError(w, err)
		return
	}
	if req.Appearance == nil || !s.cfg.Data.Appearance.Valid(*req.Appearance) {
		writeError(w, http.StatusBadRequest, "invalid_appearance")
		return
	}
	now := s.cfg.Now()
	c, err := s.cfg.Store.CreateCharacter(r.Context(), who.claims.AccountID, req.Slot, req.Name, *req.Appearance, now)
	switch {
	case errors.Is(err, ErrSlotUsed):
		writeError(w, http.StatusConflict, "slot_used")
	case errors.Is(err, ErrNameTaken):
		writeError(w, http.StatusConflict, "name_taken")
	case err != nil:
		s.storeError(w, err)
	default:
		s.cfg.Log.Info("character created", "account", who.claims.AccountID, "character", c.ID, "slot", c.Slot)
		writeJSON(w, http.StatusCreated, s.characterJSON(c, now))
	}
}

func (s *Server) renameCharacter(w http.ResponseWriter, r *http.Request, who *caller) {
	id := r.PathValue("id")
	var req struct {
		Name string `json:"name"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	if !platform.ValidAccountID(id) { // character ids are UUIDs too
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	if err := s.cfg.Data.NameFilter.Check(req.Name); err != nil {
		nameError(w, err)
		return
	}
	now := s.cfg.Now()
	c, err := s.cfg.Store.RenameCharacter(r.Context(), who.claims.AccountID, id, req.Name, now)
	var soon *RenameTooSoonError
	switch {
	case errors.As(err, &soon):
		writeJSON(w, http.StatusTooManyRequests, apiError{Error: "rename_too_soon", RetryAt: &soon.RetryAt})
	case errors.Is(err, ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found")
	case errors.Is(err, ErrOnline):
		writeError(w, http.StatusConflict, "character_online")
	case errors.Is(err, ErrNameTaken):
		writeError(w, http.StatusConflict, "name_taken")
	case err != nil:
		s.storeError(w, err)
	default:
		s.cfg.Log.Info("character renamed", "account", who.claims.AccountID, "character", c.ID)
		writeJSON(w, http.StatusOK, s.characterJSON(c, now))
	}
}

func (s *Server) deleteCharacter(w http.ResponseWriter, r *http.Request, who *caller) {
	id := r.PathValue("id")
	var req struct {
		ConfirmName string `json:"confirmName"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	if !platform.ValidAccountID(id) {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	ctx := r.Context()
	c, err := s.cfg.Store.Character(ctx, who.claims.AccountID, id)
	if errors.Is(err, ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found")
		return
	} else if err != nil {
		s.storeError(w, err)
		return
	}
	// The player types the name to confirm; case doesn't matter.
	if !strings.EqualFold(strings.TrimSpace(req.ConfirmName), c.Name) {
		writeError(w, http.StatusBadRequest, "confirm_name")
		return
	}
	switch err := s.cfg.Store.DeleteCharacter(ctx, who.claims.AccountID, id, s.cfg.Now()); {
	case errors.Is(err, ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found")
	case errors.Is(err, ErrOnline):
		writeError(w, http.StatusConflict, "character_online")
	case err != nil:
		s.storeError(w, err)
	default:
		s.cfg.Log.Info("character deleted", "account", who.claims.AccountID, "character", id)
		w.WriteHeader(http.StatusNoContent)
	}
}

// joinJSON is POST /api/join's answer.
type joinJSON struct {
	Ticket string `json:"ticket"`
	WSURL  string `json:"wsUrl"`
}

// join checks the player may enter the world now, with this character, and issues a join ticket
// (backend.md, "Join tickets"). Ban, Premium and role come fresh from the service API.
func (s *Server) join(w http.ResponseWriter, r *http.Request, who *caller) {
	var req struct {
		CharacterID string `json:"characterId"`
		WorldID     int    `json:"worldId"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	ctx := r.Context()
	now := s.cfg.Now()
	account := who.claims.AccountID
	if !platform.ValidAccountID(req.CharacterID) {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	chars, err := s.cfg.Store.Characters(ctx, account)
	if err != nil {
		s.storeError(w, err)
		return
	}
	var char *Character
	online := false
	for i := range chars {
		if chars[i].ID == req.CharacterID {
			char = &chars[i]
		}
		online = online || chars[i].Online(now)
	}
	if char == nil {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	worlds, err := s.cfg.Store.Worlds(ctx)
	if err != nil {
		s.storeError(w, err)
		return
	}
	var world *World
	for i := range worlds {
		if worlds[i].ID == req.WorldID {
			world = &worlds[i]
		}
	}
	if world == nil {
		writeError(w, http.StatusNotFound, "unknown_world")
		return
	}

	fresh, err := s.cfg.Accounts.Account(ctx, account)
	if err != nil {
		s.freshError(w, err)
		return
	}
	premium := fresh.HasPremium()
	switch {
	case fresh.Banned:
		writeError(w, http.StatusForbidden, "banned")
		return
	case world.PremiumOnly && !premium:
		writeError(w, http.StatusForbidden, "premium_required")
		return
	case online:
		// One character per account online at a time, on any world.
		writeError(w, http.StatusConflict, "already_online")
		return
	}
	players, up := s.cfg.Worlds.Status(ctx, world.ID)
	switch {
	case !up:
		writeError(w, http.StatusServiceUnavailable, "world_offline")
		return
	case players >= world.MaxPlayers:
		writeError(w, http.StatusServiceUnavailable, "world_full")
		return
	}

	tk, err := ticket.Sign(s.cfg.TicketKey, ticket.Payload{
		AccountID: account, CharacterID: char.ID, WorldID: strconv.Itoa(world.ID), Name: char.Name,
		Appearance: &char.Appearance, Role: string(fresh.Role), Premium: premium, Nonce: ticket.NewNonce(), Exp: now.Add(ticket.TTL).Unix(),
	})
	if err != nil {
		s.cfg.Log.Error("signing a join ticket failed", "err", err)
		writeError(w, http.StatusInternalServerError, "internal")
		return
	}
	s.cfg.Log.Info("join ticket issued", "account", account, "character", char.ID, "world", world.ID)
	writeJSON(w, http.StatusOK, joinJSON{Ticket: tk, WSURL: s.wsURL(*world)})
}

// wsURL is where a player's browser connects to the world: PublicWS, with {id} replaced by the
// world's id (for several local worlds on their own ports), then the world's path.
func (s *Server) wsURL(wd World) string {
	return strings.ReplaceAll(s.cfg.PublicWS, "{id}", strconv.Itoa(wd.ID)) + wd.WSPath
}

func (s *Server) storeError(w http.ResponseWriter, err error) {
	s.cfg.Log.Error("database error", "err", err)
	writeError(w, http.StatusServiceUnavailable, "unavailable")
}
