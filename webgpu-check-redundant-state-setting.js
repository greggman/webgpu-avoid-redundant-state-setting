import { getAndResetRedundantCallInfo } from './webgpu-avoid-redundant-state-setting.js';

window.requestAnimationFrame = (function(origFn) {
  return function(fn) {
    return origFn.call(this, (time) => {
      const info = getAndResetRedundantCallInfo();
      console.log('rc:', info.setVertexBuffer + info.setIndexBuffer + info.setBindGroup, JSON.stringify(info));
      fn(time);
    });
  };
})(window.requestAnimationFrame);