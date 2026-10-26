# 0003: link lifetimes

Status: open

## Question
What is the default link lifetime, and the maximum a link may ever live?

## Proposed in the design
24 hours default (`ttl_seconds` in `engine.json`) and a 7 day maximum (`max_ttl` in the gateway).

## Blocks
Gateway configuration and conformance behaviour B5.
