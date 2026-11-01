# Disposable staging submissions

This branch is **throwaway**. It is the destination the write gateway's staging deployment
commits into, and it is deleted when the pilot is over.

Everything the gateway writes here is staging content. It is not a consumer's submission, it is
not reviewed by anybody, and it is never transferred anywhere: the submissions-to-consumer
transfer path is not part of this stage, and this branch is not a consumer repository.

The task folder the pilot uses is `plans/pilot-001/submissions/wo-10008/10008-1-001-01`, and it holds
the `.keep` placeholder. The gateway never creates a branch and never creates a folder: this
branch is prepared by the operator, and `ops/staging-estate.py` prepares it.
