# Change Log

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
