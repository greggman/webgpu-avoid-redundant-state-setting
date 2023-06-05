# webgpu-avoid-redundant-state-setting

Setting state multiple times can be a source of lost performance.
There's overhead in calling from JavaScript into the WebGPU api.
There's also no guarantee the implementation optimizes this stuff
under the hood.

So, this is an attempt at

1. ## Trivially doing it for you

   In this case just add

   ```js
   import 'https://greggman.github.io/webgpu-avoid-redundant-state-setting/webgpu-avoid-redundant-state-setting.js';
   ```

   or

   ```html
   <script type="module" src="https://greggman.github.io/webgpu-avoid-redundant-state-setting/webgpu-avoid-redundant-state-setting.js"></script>
   ```

   To the top of your app and see if there is any perf difference.
   
   note: there is overhead in checking for redundant state calls, especially for `setBindGroup` with dynamic offsets
   as the library has to check each offset so there is some possibility perf will be worse
   with this library. Measure for yourself or use (2) below to check your own code.

2. ## Making it easy to check if you're submitting redundant state

   This way you can optimize your code.

   In this case use

   ```js
   import 'https://greggman.github.io/webgpu-avoid-redundant-state-setting/webgpu-check-redundant-state-setting.js';
   ```

   or

   ```html
   <script type="module" src="https://greggman.github.io/webgpu-avoid-redundant-state-setting/webgpu-check-redundant-state-setting.js"></script>
   ```

   Then check the JavaScript console.

   Note: this assumes you're using `requestAnimationFrame` to render

   If you see lots of redundant state setting, refactor your code to avoid it. You can look at the source code of this library
   for some ideas. The easiest to avoid are redundant `setVertexBuffer` and `setIndexBuffer` calls. `setBindGroup` is harder
   if it has to check dynamic offsets.

   ## Important!

   You do NOT need to avoid setting all redundant state. Rather, this library is just meant to check
   if you're setting 100s or 1000s of redundant state per pass.

## Notes

There isn't very much state in WebGPU. The most (all?) state comes in `GPURenderPassEncoder` and `GPUComputePassEncoder`.
For example, you set bindGroups by calling `setBindGroup` and those are sticky until you `end` the pass encoder. 

* compute and render pass state

  * pipeline: set via `setPipeline`
  * bindGroups:   set via `setBindGroup`

* render pass state

  * vertexBuffers: set via `setVertexBuffer`
  * indexBuffer: set via `setIndexBuffer`
  * viewport: set via `setViewport`
  * scissor: set via `setScissor`
  * blendConstant: set via `setBlendConstant`
  * stencilReference: set via `setStencilReference`

The one exception is in a render pass, `executeBundles` resets some of the state, both before and after.
The states reset are the `bindGroups`, `vertexBuffers`, `indexBuffer`, and `pipeline`.

## Testing

[Live Tests](https://greggman.github.io/webgpu-avoid-redundant-state-setting/test/).

During dev, serve the repo as in `npx servez .` then open a page to [`http://locahost:8080/test/`](http://locahost:8080/test/).

## License

MIT

