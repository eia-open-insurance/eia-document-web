# Changelog

All notable changes to this repository are documented here.

The format is based on Keep a Changelog and the project uses Semantic Versioning.

## [Unreleased]

### Added

- Repository baseline.
- Document association links: the Associations tab lists linked records with type, reference,
  added date, and a shell route to the owning vertical. The add-link dialog uses a predictive
  `EntityPicker` per linked type (or a manual reference and UUID for `OTHER`), posts
  `/api/v1/documents/{id}/links`, and removes links with DELETE. Links are read from the
  document's association collection and rendered on the Overview as related records.
