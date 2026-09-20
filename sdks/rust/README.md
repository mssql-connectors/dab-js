# DAB Native Rust SDK

This directory is reserved for the Rust SDK.

When implementation begins, initialize the crate here so JavaScript and Rust
remain independent build and release units:

```text
sdks/rust/
├── Cargo.toml
├── README.md
├── src/
└── tests/
```

Do not copy the JavaScript implementation mechanically. Both SDKs should share
DAB concepts and behavior, while each public API should follow the conventions
of its language.
