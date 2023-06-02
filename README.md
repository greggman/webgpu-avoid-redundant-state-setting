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
   for some ideas. The easist to avoid are redundant `setVertexBuffer` and `setIndexBuffer` calls. `setBindGroup` is harder
   if it has to check dynamic offests.

## License

MIT

