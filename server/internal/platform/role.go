// Package platform talks to the shared account platform (docs/architecture/accounts.md): it checks
// access tokens against the platform's published keys, and asks the service API for an account's
// fresh role, Premium and ban state.
package platform

// Role is a platform role. Roles are global, shared with every game.
type Role string

// The roles, lowest rank first.
const (
	RoleNormal    Role = "normal"
	RolePremium   Role = "premium"
	RoleModerator Role = "moderator"
	RoleAdmin     Role = "admin"
	RoleOwner     Role = "owner"
)

// Roles lists every role, lowest rank first.
var Roles = []Role{RoleNormal, RolePremium, RoleModerator, RoleAdmin, RoleOwner}

// Rank is the role's rank: normal 0, premium 1, moderator 2, admin 3, owner 4. An unknown role is -1,
// below everyone.
func (r Role) Rank() int {
	for i, x := range Roles {
		if x == r {
			return i
		}
	}
	return -1
}

// Valid reports whether r is one of the platform's roles.
func (r Role) Valid() bool { return r.Rank() >= 0 }

// IsStaff is moderator and above.
func (r Role) IsStaff() bool { return r.Rank() >= RoleModerator.Rank() }

// AtLeast reports whether r ranks at or above min.
func (r Role) AtLeast(min Role) bool { return r.Valid() && r.Rank() >= min.Rank() }
