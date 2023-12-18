# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- Support for SQL functions in row-level security clauses, with a few limitations.

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
