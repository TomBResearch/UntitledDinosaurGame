# Navigation contract map

The full navigation work package is [UDG-007](../contracts/UDG-007.md). Requirements remain at their authoritative owners:

- [Domain contracts](domain.md): NavigationQuery, NavigationRoute, NavigationService, RouteStore, NavigationScope, RouteWorkTicket, RouteCompletion and RouteWorker.
- [Movement authority](movement-authority.md): generation/epoch checks, completion admission, commit guards and route interruption.
- [UDG-007 manifest and format contract](../contracts/UDG-007.md#manifest-and-format-contract): source geometry, generated assets, hashes, serialisation and startup refusal.
- [UDG-007 bounded work contract](../contracts/UDG-007.md#navigation-behaviour-and-bounded-work): destination projection, complete paths, worker/query limits and resource handling.
- [Engine validation](../integration/engines.md): Recast binary import/export and Rapier traversal proof.
- [Fixtures](../validation/fixtures.md) and [acceptance gates](../validation/acceptance-gates.md): expected path and failure outcomes.

No client route predictor, Babylon-dependent server adapter or second collision owner is introduced by these contracts. Approved navigation settings and formats will be recorded by Gate C; they are not already verified.
