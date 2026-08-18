export const INITIAL_BLOCK_GRAPH_VERSION = 1;

export function assertValidBlockGraphVersion(value: number): void {
  if (!Number.isInteger(value) || value < INITIAL_BLOCK_GRAPH_VERSION) {
    throw new Error(
      `blockGraphVersion must be an integer greater than or equal to ${INITIAL_BLOCK_GRAPH_VERSION}`,
    );
  }
}
