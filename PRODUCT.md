# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated: React + TypeScript + Vite front end, served with a small local Node server that owns a single SQLite database file (full-text search via FTS5). Chosen for durability (notes survive browser clears, backup is one file) and room to grow (sync or export later). Final choice confirmed in the design doc.

## Users

One person: the owner, working through Hack The Box and TryHackMe machines in long evening sessions in a dim room, beside a dark terminal and an attack VM. They are mid-box most of the time: enumerating, trying exploits, recording what worked, and later looking up how they did something before.

## Product Purpose

SlingSh0t replaces the owner's scattered Obsidian vault and notes with one local home for CTF work. It does two equally important jobs:

1. **Progress:** a preloaded catalog of HTB and THM boxes showing what is done, in progress, and not started.
2. **Knowledge:** writeups from a consistent template, techniques linked across boxes, and a tool index with copy-ready commands, all searchable from one box.

Success: the owner stops opening Obsidian and old notes, finds "how did I do X" with a single search, and never retypes the target IP.

## Positioning

A personal knowledge base shaped around the box workflow, not a generic notes app with tags. Boxes, techniques, and tools are linked to each other, so a technique page shows every box where it was used and how, and a tool page shows where it was used. One target context (TARGET / LHOST / LPORT) fills writeups, commands, and reverse shells everywhere.

## Operating Context

- Local web app on the owner's machine; single user; no accounts, no cloud.
- Used alongside a terminal and attack VM; the core loop is copy a command, paste into the terminal, record the result.
- Platforms: HTB and THM only.
- Writeups and notes start empty; nothing is imported from Obsidian. The technique/tool/command library is seeded from `importer/library/data`.

## Capabilities and Constraints

- Preloaded HTB + THM box catalog with status and progress per platform, imported from the platforms along with the owner's existing progress.
- Networks (Pro Labs): hosts with multiple IPs, pivots, shared credentials with per-host results, flags.
- Writeups per box, created from a template.
- Techniques as first-class pages linked to the boxes that used them, with per-box notes on how.
- Tool index; each tool carries copyable command examples with placeholders.
- One global target context (TARGET, LHOST, LPORT) that substitutes into writeups, commands, and reverse shells.
- One search across boxes, writeups, techniques, tools, and commands.
- Data lives in a local database file, not browser storage.
- Reference for quality only: ZeroBox, under a non-commercial license. No code, data, or branding is copied from it.

## Brand Commitments

Name: SlingSh0t (the zero is deliberate).

## Evidence on Hand

None yet. No logo, no notes, no catalog data. Do not fabricate box completion stats or writeups beyond clearly labelled demo content.

## Product Principles

- One place: if information about a box, technique, or tool exists, it lives here and search finds it.
- Never retype: the target context is set once and flows everywhere.
- Progress at a glance: completion status is always visible without digging.
- Consistent writeups: every box writeup has the same shape, so past work is easy to scan.
- Calm for long sessions: built for hours of use in a dim room.
