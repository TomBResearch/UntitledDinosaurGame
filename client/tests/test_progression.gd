extends GutTest
## The client's XP table must match the server's (server/internal/progression) and the wiki.

var p: Progression


func before_all() -> void:
	p = Progression.load_default()


func test_anchor_totals_match_the_design_doc() -> void:
	assert_eq(p.xp_for_level(1), 0)
	assert_eq(p.xp_for_level(2), 75)
	assert_eq(p.xp_for_level(10), 1805)
	assert_eq(p.xp_for_level(50), 83486)
	assert_eq(p.xp_for_level(92), 3026312)
	assert_eq(p.xp_for_level(99), 5815243)
	assert_eq(p.xp_for_level(100), 6387165)


func test_level_for_xp_boundaries() -> void:
	assert_eq(p.level_for_xp(0), 1)
	assert_eq(p.level_for_xp(74), 1)
	assert_eq(p.level_for_xp(75), 2)
	assert_eq(p.level_for_xp(6387164), 99)
	assert_eq(p.level_for_xp(6387165), 100)
	assert_eq(p.level_for_xp(p.max_xp), 100)
