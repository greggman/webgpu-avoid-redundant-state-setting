const redundantCalls = {
  setVertexBuffer: 0,
  setIndexBuffer: 0,
  setBindGroup: 0,
  setViewport: 0,
  setScissor: 0,
  setBlendConstant: 0,
  setStencilReference: 0,
};

export function getAndResetRedundantCallInfo() {
  const info = {...redundantCalls};

  redundantCalls.setVertexBuffer = 0;
  redundantCalls.setIndexBuffer = 0;
  redundantCalls.setBindGroup = 0;
  redundantCalls.setViewport = 0;
  redundantCalls.setScissor = 0;
  redundantCalls.setBlendConstant = 0;
  redundantCalls.setStencilReference = 0;

  return info;
}

// Is this premature optimization?
const freeRenderPassState = [];
const renderPassToStateMap = new Map();

class RenderPassState {
  vertexState = [];
  bindGroups = [];
  indexState = {};
  pipeline = undefined;
  viewport = [-1, -1, -1, -1, -1, -1];
  scissor = [-1, -1, -1, -1];
  blendConstant = [0, 0, 0, 0];
  stencilReference = 0;

  resetForExecuteBundles() {
    this.vertexState.length = 0;
    this.bindGroups.length = 0;
    this.indexState.buffer = null;
    this.pipeline = null;
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

window.requestAnimationFrame = (function(origFn) {
  return function(fn) {
    return origFn.call(this, (time) => {
      const info = getAndResetRedundantCallInfo();
      console.log('rc:', info.setVertexBuffer + info.setIndexBuffer + info.setBindGroup, JSON.stringify(info));
      fn(time);
    });
  };
})(window.requestAnimationFrame);

GPUCommandEncoder.prototype.beginRenderPass = (function(origFn) {
  return function(...args) {
    const pass = origFn.call(this, ...args);
    // TODO: We should try to set viewport and scissor from colorAttachments/depthStencilAttachment
    // but those only have textureViews and so we'd need to keep a map of views to textures.
    // I expect viewports and scissor are not set often so this seems overkill.
    renderPassToStateMap.set(pass, getRenderPassState());
    return pass;
  };
})(GPUCommandEncoder.prototype.beginRenderPass);

GPUCommandEncoder.prototype.executeBundles = (function(origFn) {
  return function(...args) {
    renderPassToStateMap.get(this).resetForExecuteBundles();
    origFn.call(this, ...args);
  };
})(GPUCommandEncoder.prototype.executeBundles);

GPUDevice.prototype.createBindGroupLayout = (function(origFn) {
  return function(desc) {
    const layout = origFn.call(this, desc);
    // TODO: use weakmap?
    layout.desc = desc;
    let numDynamicOffsets = 0;
    for (const entry of desc.entries) {
      numDynamicOffsets += entry.buffer?.hasDynamicOffset ? 1 : 0;
    }
    layout.numDynamicOffsets = numDynamicOffsets;
    return layout;
  };
})(GPUDevice.prototype.createBindGroupLayout);

GPUDevice.prototype.createBindGroup = (function(origFn) {
  return function(desc) {
    const bg = origFn.call(this, desc);
    bg.desc = desc;
    bg.numDynamicOffsets = desc.layout.numDynamicOffsets;
    return bg;
  };
})(GPUDevice.prototype.createBindGroup);

function getDynamicOffsetsLength(bindGroup, length) {
  // the bindgroup was layout 'auto';
  if (bindGroup.numDynamicOffsets === undefined) {
    return 0;
  }
  return length === undefined
     ? bindGroup.numDynamicOffsets
     : Math.min(length, bindGroup.numDynamicOffsets);
}

function ASSERT(cond) {
  if (!cond) {
    debugger;
    throw new Error('assert');
  }
}

function bindGroupSame(bg, bindGroup, dynamicOffsets, start, length) {
  if (!bg || bg.bindGroup !== bindGroup || bg.start !== start || bg.length !== length) {
    return false;
  };
  if (!dynamicOffsets && !bg.dynamicOffsets) {
    return true;
  }
  if (Array.isArray(dynamicOffsets) !== Array.isArray(bg.dynamicOffsets)) {
    return false;
  }
  ASSERT(bindGroup.numDynamicOffsets !== undefined);
  length = getDynamicOffsetsLength(bindGroup, length)
  if (length !== bg.dynamicOffsets.length) {
    return false;
  }
  for (let i = 0; i < length; ++i) {
    if (dynamicOffsets[start + i] !== bg.dynamicOffsets[i]) {
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

GPURenderPassEncoder.prototype.setBindGroup = (function(origFn) {
  return function(ndx, ...args) {
    const [bindGroup, dynamicOffsets, start, length] = args;
    const {bindGroups} = renderPassToStateMap.get(this);
    if (!bindGroupSame(bindGroups[ndx], bindGroup, dynamicOffsets, start, length)) {
      bindGroups[ndx] = {bindGroup, dynamicOffsets: dupOffsets(dynamicOffsets, start, length, bindGroup), start, length};
      origFn.call(this, ndx, ...args);
    } else {
      ++redundantCalls.setBindGroup;
    }
  };
})(GPURenderPassEncoder.prototype.setBindGroup);

GPURenderPassEncoder.prototype.setViewport = (function(origFn) {
  return function(...args) {
    const state = renderPassToStateMap.get(this);
    if (!arrayEquals(state.viewport, args)) {
      state.viewport = args.slice();
      origFn.call(this, ...args);
    } else {
      ++redundantCalls.setViewport;
    }
  };
})(GPURenderPassEncoder.prototype.setViewport);

GPURenderPassEncoder.prototype.setScissor = (function(origFn) {
  return function(...args) {
    const state = renderPassToStateMap.get(this);
    if (!arrayEquals(state.scissor, args)) {
      state.scissor = args.slice();
      origFn.call(this, ...args);
    } else {
      ++redundantCalls.setScissor;
    }
  };
})(GPURenderPassEncoder.prototype.setScissor);

GPURenderPassEncoder.prototype.setBlendConstant = (function(origFn) {
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
})(GPURenderPassEncoder.prototype.setBlendConstant);

GPURenderPassEncoder.prototype.setStencilReference = (function(origFn) {
  return function(newRef) {
    const state = renderPassToStateMap.get(this);
    if (!state.stencilReference !== newRef) {
      state.stencilReference = newRef;
      origFn.call(this, newRef);
    } else {
      ++redundantCalls.setStencilReference;
    }
  };
})(GPURenderPassEncoder.prototype.setStencilReference);

function vertexBufferSame(v, buffer, offset, size) {
  return v && v.buffer === buffer && v.offset === offset && v.size === size;
}

GPURenderPassEncoder.prototype.setVertexBuffer = (function(origFn) {
  return function(ndx, ...args) {
    const [buffer, offset, size] = args;
    const {vertexState} = renderPassToStateMap.get(this);
    if (!vertexBufferSame(vertexState[ndx], buffer, offset, size)) {
      vertexState[ndx] = {buffer, offset, size};
      origFn.call(this, ndx, ...args);
    } else {
      ++redundantCalls.setVertexBuffer;
    }
  };
})(GPURenderPassEncoder.prototype.setVertexBuffer);

GPURenderPassEncoder.prototype.setIndexBuffer = (function(origFn) {
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
})(GPURenderPassEncoder.prototype.setIndexBuffer);

GPURenderPassEncoder.prototype.end = (function(origFn) {
  return function(...args) {
    const state = renderPassToStateMap.get(this);
    renderPassToStateMap.delete(this);
    freeRenderPassState.push(state.reset());
    return origFn.call(this, ...args);
  };
})(GPURenderPassEncoder.prototype.end);
