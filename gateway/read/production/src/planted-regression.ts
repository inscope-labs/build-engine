// PLANTED FAILURE - the S3 demonstration of a gate that blocks a deployment.
//
// This file exists on the throwaway branch only and is never merged. It is a type error
// on purpose: `npm run typecheck` in the read gateway's deploy gate must fail because of
// it, and the deploy must not happen.
export const planted: number = "this is not a number";
