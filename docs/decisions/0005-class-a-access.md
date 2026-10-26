# 0005: Class A access

Status: **decided** (2026-10-26)

## Question
Class A agents use authenticated git or curl. Are the private raw `url` fields in each context item enough for them, with their own credentials?

## Decision
- Yes. The private raw `url` fields already present in each context item are sufficient for Class A agents.
- No additional Class A-specific gateway, export, or tooling is required.
- Class A and Class B remain **strictly separate trust paths**:
  - Class A agents hold their own repository credentials and use the raw URLs.
  - Class B agents hold no repository credentials and use only the signed gateway links.
  - No shared credentials, no weakening of Class B controls for Class A convenience.

## Rationale
Class A agents already possess the capability to authenticate to the private repository. Introducing a second path for them would add complexity without security benefit and risks blurring the trust boundary that protects Class B.

## Consequences
- No new code or configuration is required for Class A support beyond the existing raw `url` fields.
- Documentation and prompts must continue to present the two paths as distinct.
- Security reviews of Class B must not assume any Class A credential material is present in the Class B environment.

## Blocks resolved
Confirmation that nothing further must be built for Class A.
