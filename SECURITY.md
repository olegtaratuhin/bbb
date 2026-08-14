# Security policy

Beads for bb is a full-trust bb plugin. It runs inside the bb server process,
invokes `bd`, and can access project data through bb's host APIs.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository:

<https://github.com/olegtaratuhin/bbb/security/advisories/new>

Do not disclose credentials, private issue databases, or an exploitable
reproduction in a public issue. Include the affected version, bb and bd
versions, impact, reproduction steps, and any suggested mitigation.

Supported versions are the latest tagged release and the current default
branch. Security fixes may be released independently of UI changes.
