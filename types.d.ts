type RedundantCalls = {
  setPipeline: number,
  setVertexBuffer: number,
  setIndexBuffer: number,
  setBindGroup: number,
  setViewport: number,
  setScissorRect: number,
  setBlendConstant: number,
};

/**
 * Gets WebGPU redundant call counts and resets to 0.
 */
export declare function getAndResetRedundantCallInfo(): RedundantCalls;
