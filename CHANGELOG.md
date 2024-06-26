# Change Log

# [0.7.0] - 2024-05-10

BREAKING CHANGES:

- delete `getAccountInfo` method
- remove option `proto`
- rename option `userId` to `username`
- introduce `pool` option which is described here https://docs.selectel.ru/control-panel-actions/infrastructure/#selectel-infrastructure

# [0.6.3] - 2021-08-22

- bump `got` to 11 stable
- improve typings

# [0.6.2] - 2020-03-28

- `deleteFiles` now returns JSON body only

# [0.6.1] - 2020-03-22

- fixed bug w/ incorrect understanding of numeric domain usage in two requests;

# [0.6.0] - 2020-03-22

- migrated to `got@^10.6.0`

# [0.5.0] - 2019-02-28

- `userId` now public, since we need it sometimes from outside, i.e. when we want to cache token
- `token` now acceptable as class parameter

# [0.4.0] - 2019-02-26

- removed rollup since lib consist of one file
- methods code are wrapped in Promises to be capable to catch all exceptions on the runner side
- removed catch handlers

# [0.3.4] - 2019-01-17

- `uploadFile`: `fileName` now optional


# [0.3.3] - 2019-01-17

- `uploadFile`: added possibility to send archives, which could be automatically extracted


# [0.3.0] - 2018-12-06

### Breaking

- migrated from `response` to `got`, because there were issues with streaming PUT requests

# [0.2.0] - 2018-12-01

### Changed

 - `uploadFile` now uses streaming to send file and it now can accept `stream` too
