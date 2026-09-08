// Shared public wire contract; private ranking and policy remain server-only.
import type { CompletionObservation, ExecutionContext } from "../../os1-route-core/src/execution-context";
export { validExecutionContext, validCompletionFeedback, completionFeedbackMatchesTask, type ExecutionContext,
  type CompletionFeedback, type CompletionObservation } from "../../os1-route-core/src/execution-context";

/** Preserve the caller's scope; opaque evaluator results do not reveal usage. */
export function appendCompletionObservation(context: ExecutionContext | undefined,
  observation: CompletionObservation): ExecutionContext | undefined {
  if (!context?.completion_feedback) return context;
  return { ...context, completion_feedback: { ...context.completion_feedback,
    observations: [...context.completion_feedback.observations, observation].slice(-16),
  } };
}
