/**
 * @typedef {Object} RedundantCalls
 * @property {number} setPipeline
 * @property {number} setVertexBuffer
 * @property {number} setIndexBuffer
 * @property {number} setBindGroup
 * @property {number} setViewport
 * @property {number} setScissorRect
 * @property {number} setBlendConstant
 * @property {number} setStencilReference
 */
const redundantCalls = {
  setPipeline: 0,
  setVertexBuffer: 0,
  setIndexBuffer: 0,
  setBindGroup: 0,
  setViewport: 0,
  setScissorRect: 0,
  setBlendConstant: 0,
  setStencilReference: 0,
};

/**
 * 
 * @returns RedundantCalls
 */
export function getAndResetRedundantCallInfo() {
  const info = {...redundantCalls};

  redundantCalls.setPipeline = 0;
  redundantCalls.setVertexBuffer = 0;
  redundantCalls.setIndexBuffer = 0;
  redundantCalls.setBindGroup = 0;
  redundantCalls.setViewport = 0;
  redundantCalls.setScissorRect = 0;
  redundantCalls.setBlendConstant = 0;
  redundantCalls.setStencilReference = 0;

  return info;
}

if (typeof GPUDevice !== 'undefined') {

  // Is this premature optimization?
  const freeRenderPassState = [];
  const renderPassToStateMap = new Map();
  const bindGroupLayoutToNumDynamicOffsetsMap = new WeakMap();
  const numDynamicOffsetsSym = Symbol('numDynamicOffsets');

  class RenderPassState {
    vertexState = [];
    bindGroupState = [];
    indexState = {};
    currentPipeline = undefined;
    viewport = [-1, -1, -1, -1, -1, -1];
    scissor = [-1, -1, -1, -1];
    blendConstant = [0, 0, 0, 0];
    stencilReference = 0;

    resetForExecuteBundles() {
      this.vertexState.length = 0;
      this.bindGroupState.length = 0;
      this.indexState.buffer = null;
      this.currentPipeline = null;
      return this;
    }
    reset() {
      this.resetForExecuteBundles();
      this.viewport = [-1, -1, -1, -1, -1, -1];
      this.scissor = [-1, -1, -1, -1];
      this.blendConstant = [0, 0, 0, 0];
      this.stencilReference = 0;
      return this;
    }
  }

  function normalizeColor(c) {
    return c.r === undefined
       ? c
       : [c.r, c.g, c.b, c.a];
  }

  function getRenderPassState() {
    if (freeRenderPassState.length === 0) {
      freeRenderPassState.push(new RenderPassState());
    }
    return freeRenderPassState.pop().reset();
  }

  function arrayEquals(a, b) {
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; ++i) {
      if (a[i] !== b[i]) {
        return false;
      }
    }
    return true;
  }

  function wrapFn(ctor, name, fn) {
    ctor.prototype[name] = fn(ctor.prototype[name]);
  }

  wrapFn(GPUCommandEncoder, 'beginRenderPass', function(origFn) {
    return function(...args) {
      const pass = origFn.call(this, ...args);
      // TODO: We should try to set viewport and scissor from colorAttachments/depthStencilAttachment
      // but those only have textureViews and so we'd need to keep a map of views to textures.
      // I expect viewport and scissor are not set often so this seems overkill.
      renderPassToStateMap.set(pass, getRenderPassState());
      return pass;
    };
  })

  wrapFn(GPUCommandEncoder, 'executeBundles', function(origFn) {
    return function(...args) {
      renderPassToStateMap.get(this).resetForExecuteBundles();
      origFn.call(this, ...args);
    };
  });

  wrapFn(GPUDevice, 'createBindGroupLayout', function(origFn) {
    return function(desc) {
      const layout = origFn.call(this, desc);
      let numDynamicOffsets = 0;
      for (const entry of desc.entries) {
        numDynamicOffsets += entry.buffer?.hasDynamicOffset ? 1 : 0;
      }
      bindGroupLayoutToNumDynamicOffsetsMap.set(layout, numDynamicOffsets)
      return layout;
    };
  });

  wrapFn(GPUDevice, 'createBindGroup', function(origFn) {
    return function(desc) {
      const bg = origFn.call(this, desc);
      bg[numDynamicOffsetsSym] = bindGroupLayoutToNumDynamicOffsetsMap.get(desc.layout);
      return bg;
    };
  });

  function getDynamicOffsetsLength(bindGroup, length) {
    // the bindGroup was layout 'auto';
    const numDynamicOffsets = bindGroup[numDynamicOffsetsSym];
    if (numDynamicOffsetsSym === undefined) {
      return 0;
    }
    return length === undefined
       ? numDynamicOffsets
       : Math.min(length, numDynamicOffsets);
  }

  function ASSERT(cond) {
    if (!cond) {
      debugger;
      throw new Error('assert');
    }
  }

  function bindGroupSame(cachedBindGroup, bindGroup, dynamicOffsets, start, length) {
    if (!cachedBindGroup || cachedBindGroup.bindGroup !== bindGroup || cachedBindGroup.start !== start || cachedBindGroup.length !== length) {
      return false;
    };
    if (!dynamicOffsets && !cachedBindGroup.dynamicOffsets) {
      return true;
    }
    const cachedDynamicOffsets = cachedBindGroup.dynamicOffsets;
    if (Array.isArray(dynamicOffsets) !== Array.isArray(cachedDynamicOffsets)) {
      return false;
    }
    ASSERT(bindGroup.numDynamicOffsets !== undefined);
    length = getDynamicOffsetsLength(bindGroup, length)
    if (length !== cachedDynamicOffsets.length) {
      return false;
    }
    for (let i = 0; i < length; ++i) {
      if (dynamicOffsets[start + i] !== cachedDynamicOffsets[i]) {
        return false;
      }
    }
    return true;
  }

  function dupOffsets(offsets, start, length, bindGroup) {
    length = getDynamicOffsetsLength(bindGroup, length)
    if (Array.isArray(offsets)) {
      return offsets.slice(0, length);
    }
    if (offsets instanceof Uint32Array) {
      return offsets.slice(start || 0, length);
    }
    return offsets;
  }

  wrapFn(GPURenderPassEncoder, 'setBindGroup', function(origFn) {
    return function(ndx, ...args) {
      const [bindGroup, dynamicOffsets, start, length] = args;
      const {bindGroupState} = renderPassToStateMap.get(this);
      if (!bindGroupSame(bindGroupState[ndx], bindGroup, dynamicOffsets, start, length)) {
        bindGroupState[ndx] = {bindGroup, dynamicOffsets: dupOffsets(dynamicOffsets, start, length, bindGroup), start, length};
        origFn.call(this, ndx, ...args);
      } else {
        ++redundantCalls.setBindGroup;
      }
    };
  });

  wrapFn(GPURenderPassEncoder, 'setViewport', function(origFn) {
    return function(...args) {
      const state = renderPassToStateMap.get(this);
      if (!arrayEquals(state.viewport, args)) {
        state.viewport = args.slice();
        origFn.call(this, ...args);
      } else {
        ++redundantCalls.setViewport;
      }
    };
  });

  wrapFn(GPURenderPassEncoder, 'setScissorRect', function(origFn) {
    return function(...args) {
      const state = renderPassToStateMap.get(this);
      if (!arrayEquals(state.scissor, args)) {
        state.scissor = args.slice();
        origFn.call(this, ...args);
      } else {
        ++redundantCalls.setScissorRect;
      }
    };
  });

  wrapFn(GPURenderPassEncoder, 'setBlendConstant', function(origFn) {
    return function(newColor) {
      const state = renderPassToStateMap.get(this);
      const color = normalizeColor(newColor);
      if (!arrayEquals(state.blendConstant, color)) {
        state.blendConstant = color.slice();
        origFn.call(this, newColor);
      } else {
        ++redundantCalls.setBlendConstant;
      }
    };
  });

  wrapFn(GPURenderPassEncoder, 'setStencilReference', function(origFn) {
    return function(newRef) {
      const state = renderPassToStateMap.get(this);
      if (state.stencilReference !== newRef) {
        state.stencilReference = newRef;
        origFn.call(this, newRef);
      } else {
        ++redundantCalls.setStencilReference;
      }
    };
  });

  wrapFn(GPURenderPassEncoder, 'setPipeline', function(origFn) {
    return function(pipeline) {
      const state = renderPassToStateMap.get(this);
      if (state.currentPipeline !== pipeline) {
        state.currentPipeline = pipeline;
        origFn.call(this, pipeline);
      } else {
        ++redundantCalls.setPipeline;
      }
    };
  });

  function vertexBufferSame(v, buffer, offset, size) {
    return v && v.buffer === buffer && v.offset === (offset || 0) && v.size === (size === undefined ? buffer.size : size);
  }

  wrapFn(GPURenderPassEncoder, 'setVertexBuffer', function(origFn) {
    return function(ndx, ...args) {
      const [buffer, offset, size] = args;
      const {vertexState} = renderPassToStateMap.get(this);
      if (!vertexBufferSame(vertexState[ndx], buffer, offset, size)) {
        vertexState[ndx] = {buffer, offset: offset || 0, size: size === undefined ? buffer.size : size};
        origFn.call(this, ndx, ...args);
      } else {
        ++redundantCalls.setVertexBuffer;
      }
    };
  });

  wrapFn(GPURenderPassEncoder, 'setIndexBuffer', function(origFn) {
    return function(...args) {
      let [buffer, format, offset, size] = args;
      const {indexState} = renderPassToStateMap.get(this);
      offset = offset || 0;
      size = size === undefined
         ? buffer.size - offset
         : size;
      if (buffer !== indexState.buffer ||
          format !== indexState.format ||
          offset !== indexState.offset ||
          size !== indexState.size) {
        indexState.buffer = buffer;
        indexState.format = format;
        indexState.offset = offset;
        indexState.size = size;
        origFn.call(this, ...args);
      } else {
        ++redundantCalls.setIndexBuffer;
      }
    };
  });

  wrapFn(GPURenderPassEncoder, 'end', function(origFn) {
    return function(...args) {
      const state = renderPassToStateMap.get(this);
      renderPassToStateMap.delete(this);
      freeRenderPassState.push(state.reset());
      return origFn.call(this, ...args);
    };
  });

}
