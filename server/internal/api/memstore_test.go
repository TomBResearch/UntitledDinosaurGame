package api_test

import (
	"testing"
	"time"

	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/api"
	"github.com/TomBResearch/UntitledDinosaurGame/server/internal/api/storetest"
)

func TestMemStoreContract(t *testing.T) {
	storetest.Run(t,
		func(*testing.T) api.Store {
			return api.NewMemStore(
				api.World{ID: 1, Name: "World 1", MaxPlayers: 1000, WSPath: "/w/1"},
				api.World{ID: 2, Name: "World 2", PremiumOnly: true, MaxPlayers: 1000, WSPath: "/w/2"})
		},
		storetest.Hooks{
			SetOnline: func(_ *testing.T, s api.Store, id string, world int, until time.Time) {
				s.(*api.MemStore).SetOnline(id, world, until)
			},
			SetSkillXP: func(_ *testing.T, s api.Store, id, skill string, xp int64) {
				s.(*api.MemStore).SetSkillXP(id, skill, xp)
			},
		})
}
