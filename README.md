# Disposable staging submissions

This repository is **throwaway**. It is the destination the write gateway's staging deployment
commits into, and it is deleted when the pilot is over.

Everything the gateway writes here is staging content. It is not a consumer's submission, it is
not reviewed by anybody, and it is never transferred anywhere: the submissions-to-consumer
transfer path is not part of this stage, and this repository is not a consumer repository.

The gateway's staging branch is `staging-build-engine`, and it holds the task folder the pilot
uses, with its `.keep` placeholder. The gateway never creates a branch and never creates a
folder: this repository is prepared by the operator, and `ops/staging-estate.py` prepares it.
