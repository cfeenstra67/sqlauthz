# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

## [0.6.0] - 2023-12-24

### Added

- Add support for globs in `--rules` argument

- Add support for `sql.cast()`

### Fixed

- Error preventing usage of `--dry-run` and `--dry-run-short`

## [0.5.0] - 2023-12-22

### Added

- Add support for managing sequence permissions.

## [0.4.0] - 2023-12-22

### Added

- Add support for managing function and procedure permissions.

## [0.3.0] - 2023-12-22

### Added

- Add support for assigning permissions to groups

- Add support for managing view permissions

### Fixed

- Fixed error constructing table columns when views exist

- Fixed issue with using `resource.type` for tables

## [0.2.1] - 2023-12-18

### Fixed

- Only revoke privileges that can be granted with `sqlauthz`.

## [0.2.0] - 2023-12-18

### Added

- Support for SQL functions in row-level security clauses, with a few limitations.

- Support for assigning permissions to groups

- Add all permissions for tables and schemas

## [0.1.2] - 2023-12-16

### Added

- Added `NO_DOTENV` environment variable to disable loading environment variables from `.env` file.

### Changed

- Quote row-level security policy names in `CREATE POLICY` queries.

## [0.1.1] - 2023-12-16

### Fixed

- Fixed `allowAnyUser` argument to actually work

## [0.1.0] - 2023-12-16

### Added

- Exposed user revoke strategies and `allowAnyUser` in the CLI.

- Added basic documentation in the README.

## [0.0.3] - 2023-12-15

### Fixed

- Include `src` directory in package

## [0.0.2] - 2023-12-15

### Added

- Initial implementation of `sqlauthz`
