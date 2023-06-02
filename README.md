# webgpu-avoid-redundant-state-setting

Setting state multiple times can be a source of lost performance.
There's overhead in calling from JavaScript into the WebGPU api.
There's also no guarantee the implementation optimizes this stuff
under the hood.

So, this is an attempt at

1. Trivially doing it for you

   In this case just add

   ```js
   import 'webgpu-avoid-redundant-state-setting.js';
   ```

   or

   ```html
   <script type="module" src="webgpu-avoid-redundant-state-setting.js"></script>
   ```

   To the top of your app and see if there is any perf difference.

2. Making it easy to check if you're submitting redundant state

   This way you can optimize your code.

   In this case use

   ```js
   import 'webgpu-check-redundant-state-setting.js';
   ```

   or

   ```html
   <script type="module" src="webgpu-check-redundant-state-setting.js"></script>
   ```

   Then check the JavaScript console.

   Note: this assumes you're using `requestAnimationFrame` to render

## License

MIT

