# Change Log

# [0.2.0] - 2018-12-01

### Changed

 - `uploadFile` now uses streaming to send file and it now can accept `stream` too

# [0.3.0] - 2018-12-06

### Breaking

- migrated from `response` to `got`, because there were issues with streaming PUT requests
