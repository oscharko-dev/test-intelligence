# Architecture Decision Records

This directory holds Architecture Decision Records (ADRs): short documents that
capture a significant architectural decision, the context that forced it, and
its consequences. ADRs make the reasoning behind boundaries, dependency
directions, and cross-cutting contracts durable and reviewable.

## Convention

ADRs follow the [Michael Nygard format](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).
Each record is a Markdown file named `NNNN-kebab-title.md`, where `NNNN` is a
zero-padded, monotonically increasing number (`0001`, `0002`, ...). A record
states its status (`Proposed`, `Accepted`, `Superseded`, or `Deprecated`) and
date in the header, and is structured as Context, Decision, Consequences, and —
where relevant — Alternatives considered and Implementation notes.

Once accepted, an ADR is immutable; a later decision that changes it is recorded
as a new ADR that supersedes the earlier one.

## Index

| ADR                                                              | Title                                            | Status   | Date       |
| ---------------------------------------------------------------- | ------------------------------------------------ | -------- | ---------- |
| [0001](0001-workbench-storage-adapter-and-migration-contract.md) | Workbench storage adapter and migration contract | Accepted | 2026-05-30 |
