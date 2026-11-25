package migrations

import "testing"

// The embedded files are well named and numbered (no database needed).
func TestAll(t *testing.T) {
	all, err := All()
	if err != nil {
		t.Fatal(err)
	}
	if len(all) == 0 || all[0].Version != 1 || all[0].SQL == "" {
		t.Fatalf("migrations: %+v", all)
	}
}
