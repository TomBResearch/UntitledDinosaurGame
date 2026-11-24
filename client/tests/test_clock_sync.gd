extends GutTest
## Clock sync: offset from pongs, lowest-RTT samples win, slewing rather than jumping.
## Times are passed in explicitly; nothing waits.

const HZ := 20
## 1 tick = 50 ms at 20 Hz.
const TICK_MS := 50.0


func _clock() -> ClockSync:
	var c := ClockSync.new()
	c.tick_hz = HZ
	return c


## A pong for a server whose time is client time + true_offset_ms, sent at sent_ms with the given
## round trip split evenly.
func _pong(c: ClockSync, true_offset_ms: float, sent_ms: float, rtt_ms: float, up_share: float = 0.5) -> void:
	var server_ms := sent_ms + rtt_ms * up_share + true_offset_ms
	var ticks := server_ms / TICK_MS
	var tick := floori(ticks)
	var phase := floori((ticks - float(tick)) * 256.0)
	c.add_pong(sent_ms, sent_ms + rtt_ms, tick, phase)


func test_one_pong_sets_the_offset() -> void:
	var c := _clock()
	assert_false(c.is_synced())
	_pong(c, 100000.0, 1000.0, 80.0)
	assert_true(c.is_synced())
	assert_almost_eq(c.offset_ms(), 100000.0, 0.3, "phase is in 256ths of a tick (0.2 ms)")
	# At client time 2000 the server is at 102000 ms = tick 2040.
	assert_almost_eq(c.server_tick_at(2000.0), 2040.0, 0.01)


func test_tick_phase_counts() -> void:
	var c := _clock()
	# Server at tick 100 and half a tick when it replied; zero round trip.
	c.add_pong(500.0, 500.0, 100, 128)
	assert_almost_eq(c.server_tick_at(500.0), 100.5, 0.0001)


func test_a_slow_sample_is_not_averaged_in() -> void:
	var c := _clock()
	_pong(c, 7000.0, 0.0, 300.0, 0.1)
	_pong(c, 5000.0, 1000.0, 20.0)
	assert_almost_eq(c.target_offset_ms(), 5000.0, 0.5, "only samples near the best round trip count")


func test_lowest_rtt_samples_win() -> void:
	var c := _clock()
	# Fast, symmetric samples say the offset is 5000 ms.
	_pong(c, 5000.0, 0.0, 40.0)
	_pong(c, 5000.0, 1000.0, 42.0)
	_pong(c, 5000.0, 2000.0, 41.0)
	# A slow, lopsided sample (the reply was held up) would say about 5000 - 150.
	_pong(c, 5000.0, 3000.0, 340.0, 0.06)
	assert_almost_eq(c.target_offset_ms(), 5000.0, 0.5, "the slow sample is ignored")


func test_offset_slews_instead_of_jumping() -> void:
	var c := _clock()
	_pong(c, 1000.0, 0.0, 30.0)
	# A better sample says the offset is 40 ms more.
	_pong(c, 1040.0, 100.0, 15.0)
	assert_almost_eq(c.target_offset_ms(), 1020.0, 0.5, "mean of the two samples")
	assert_almost_eq(c.offset_ms(), 1000.0, 0.5, "not applied at once")
	c.update(110.0)
	var before := c.offset_ms()
	assert_false(c.update(210.0), "a slew is not a snap")
	# 100 ms of real time moves it by at most 5 ms.
	assert_almost_eq(c.offset_ms() - before, 5.0, 0.01)
	c.update(10000.0)
	assert_almost_eq(c.offset_ms(), 1020.0, 0.5, "converges")


func test_estimated_time_never_runs_backwards_while_slewing() -> void:
	var c := _clock()
	_pong(c, 1000.0, 0.0, 50.0)
	# A sample says the server is 200 ms behind what we thought: slew down, not step down.
	_pong(c, 800.0, 100.0, 10.0)
	_pong(c, 800.0, 200.0, 10.0)
	_pong(c, 800.0, 300.0, 10.0)
	var last := c.server_tick_at(310.0)
	var now := 310.0
	for i in 200:
		now += 16.0
		c.update(now)
		var t := c.server_tick_at(now)
		assert_true(t > last, "time moves forward")
		last = t


func test_a_large_error_snaps_and_says_so() -> void:
	var c := _clock()
	_pong(c, 1000.0, 0.0, 50.0)
	c.update(100.0)
	# The server restarted or the machine slept: 10 s off.
	for i in 3:
		_pong(c, 11000.0, 200.0 + i * 100.0, 5.0)
	assert_almost_eq(c.offset_ms(), c.target_offset_ms(), 0.001, "snapped")
	assert_true(c.update(600.0), "update reports the snap once")
	assert_false(c.update(616.0))


func test_welcome_counts_as_a_rough_first_sample() -> void:
	var c := _clock()
	# hello sent at 0, welcome at 60 ms with server tick 200.
	c.add_welcome(0.0, 60.0, 200)
	assert_true(c.is_synced())
	# Tick 200.5 plus half of (60 + one tick) of round trip, in ms, minus 60.
	assert_almost_eq(c.offset_ms(), 200.5 * TICK_MS + 55.0 - 60.0, 0.001)
	# A real pong with a similar round trip beats it.
	_pong(c, 9000.0, 100.0, 60.0)
	_pong(c, 9000.0, 1100.0, 60.0)
	_pong(c, 9000.0, 2100.0, 60.0)
	assert_almost_eq(c.target_offset_ms(), 9000.0, 0.5)


func test_window_forgets_old_samples() -> void:
	var c := _clock()
	_pong(c, 1000.0, 0.0, 1.0)  # very fast, but old
	for i in ClockSync.WINDOW:
		_pong(c, 2000.0, 1000.0 + i * 1000.0, 30.0)
	assert_almost_eq(c.target_offset_ms(), 2000.0, 0.5)
