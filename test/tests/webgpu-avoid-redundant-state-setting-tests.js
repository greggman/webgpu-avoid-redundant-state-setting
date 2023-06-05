import {getAndResetRedundantCallInfo} from '../../webgpu-avoid-redundant-state-setting.js';

import {
  assertEqual,
  assertTruthy,
} from '../assert.js';

import {describe, it} from '../mocha-support.js';

describe('webgpu-avoid-redundant-state-setting', () => {
  let device;
  let encoder;

  before(async() => {
    const adapter = await navigator.gpu?.requestAdapter();
    device = await adapter?.requestDevice();
    device?.addEventListener('uncapturederror', (event) => {
      assertTruthy(false, event.error.message);
    });
    encoder = device?.createCommandEncoder();
  });

  after(() => {
    encoder?.finish();
    device?.destroy();
  });

  function testSetPipeline(pass, pipeline0, pipeline1) {
    const tests = [
      { args: [pipeline0], same: false },
      { args: [pipeline0], same: true },
      { args: [pipeline1], same: false },
    ];
    for (const {args, same} of tests) {
      pass.setPipeline(...args);
      const info = getAndResetRedundantCallInfo();
      assertEqual(info.setPipeline, same ? 1 : 0, `setPipeline: ${args.join(', ')}`);
    }
  }

  function testSetBindGroup(pass, bindGroup0, bindGroup1, dynamicBindGroup0, dynamicBindGroup1) {
    const tests = [
      { args: [0, bindGroup0], same: false },
      { args: [0, bindGroup0], same: true },
      { args: [0, bindGroup1], same: false },
      { args: [0, dynamicBindGroup0, [0, 0]], same: false, label: '0' },
      { args: [0, dynamicBindGroup0, [0, 0]], same: true, label: '1' },
      { args: [0, dynamicBindGroup0, [256, 0]], same: false},
      { args: [0, dynamicBindGroup0, [0, 256]], same: false},
      { args: [0, dynamicBindGroup0, new Uint32Array([0, 0]), 0, 2], same: false},
      { args: [0, dynamicBindGroup0, new Uint32Array([256, 0]), 0, 2], same: false},
      { args: [0, dynamicBindGroup0, new Uint32Array([256, 0]), 0, 2], same: true},
      { args: [0, dynamicBindGroup0, new Uint32Array([128, 256, 0]), 1, 2], same: true},
      { args: [0, dynamicBindGroup0, new Uint32Array([256, 0]), 0, 2], same: true},
      { args: [0, dynamicBindGroup0, [256, 0]], same: true, label: 'from typedarray to native array' },
      { args: [0, dynamicBindGroup0, new Uint32Array([123, 345, 256, 0]), 2, 2], same: true, label: 'from native array to typedarray array' },
    ];
    for (const {args, same, label} of tests) {
      pass.setBindGroup(...args);
      const info = getAndResetRedundantCallInfo();
      assertEqual(info.setBindGroup, same ? 1 : 0, `setBindGroup: ${args.join(', ')} label: ${label}`);
    }    
  }

  describe('avoids redundant state setting', () => {

    describe('in compute pass', () => {

      let pass;
      let pipeline0;
      let pipeline1;
      let bindGroup0;
      let bindGroup1;
      let dynamicBindGroup0;
      let dynamicBindGroup1;

      before(() => {
        const shaderSrc = `
          @group(0) @binding(0) var<storage, read_write> data0: array<f32>;
          @group(0) @binding(2) var<storage, read_write> data1: array<f32>;

          @compute @workgroup_size(1) fn computeSomething(
            @builtin(global_invocation_id) id: vec3<u32>
          ) {
            _ = &data0;
            _ = &data1;
          }
          `;

        const module = device.createShaderModule({code: shaderSrc});
        const pipelineDesc = {
          layout: 'auto',
          compute: {
            module,
            entryPoint: 'computeSomething',
          },
        };
        pipeline0 = device.createComputePipeline(pipelineDesc);
        pipeline1 = device.createComputePipeline(pipelineDesc);
        const storageBuffer0 = device.createBuffer({
          size: 1024,
          usage: GPUBufferUsage.STORAGE,
        });
        const storageBuffer1 = device.createBuffer({
          size: 1024,
          usage: GPUBufferUsage.STORAGE,
        });
        bindGroup0 = device.createBindGroup({
          label: 'group0',
          layout: pipeline0.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: storageBuffer0 } },
            { binding: 2, resource: { buffer: storageBuffer1 } },
          ],
        });
        bindGroup1 = device.createBindGroup({
          label: 'group1',
          layout: pipeline0.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: storageBuffer0 } },
            { binding: 2, resource: { buffer: storageBuffer1 } },
          ],
        });

        const bindGroupLayout = device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage", hasDynamicOffset: true } },
            { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage", hasDynamicOffset: true } },
          ],
        });
        dynamicBindGroup0 = device.createBindGroup({
          label: 'dynamicGroup0',
          layout: bindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: storageBuffer0, size: 512 } },
            { binding: 2, resource: { buffer: storageBuffer1, size: 512 } },
          ],
        });
        dynamicBindGroup0 = device.createBindGroup({
          label: 'dynamicGroup1',
          layout: bindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: storageBuffer0, size: 512 } },
            { binding: 2, resource: { buffer: storageBuffer1, size: 512 } },
          ],
        });

        pass = encoder.beginComputePass();
      });

      after(() => {
        pass.end();
      });

      beforeEach(() => {
        getAndResetRedundantCallInfo();
      });

      it('setPipeline', () => {
        testSetPipeline(pass, pipeline0, pipeline1);
      });

      it('setBindGroup', () => {
        testSetBindGroup(pass, bindGroup0, bindGroup1, dynamicBindGroup0, dynamicBindGroup1);
      });

    });

    describe('in render pass', () => {

      let pass;
      let renderPassDescriptor;
      let pipeline0;
      let pipeline1;
      let bindGroup0;
      let bindGroup1;
      let dynamicBindGroup0;
      let dynamicBindGroup1;
      let vertexBuffer0;
      let vertexBuffer1;
      let indexBuffer0;
      let indexBuffer1;

      before(() => {
        const shaderSrc = `
          struct VSUniforms0 {
            worldViewProjection: mat4x4<f32>,
          };
          struct VSUniforms1 {
            worldInverseTranspose: mat4x4<f32>,
          };
          @group(0) @binding(0) var<uniform> vsUniforms0: VSUniforms0;
          @group(0) @binding(2) var<uniform> vsUniforms1: VSUniforms1;

          struct MyVSInput {
              @location(0) position: vec4<f32>,
              @location(1) normal: vec3<f32>,
              @location(2) texcoord: vec2<f32>,
          };

          struct MyVSOutput {
            @builtin(position) position: vec4<f32>,
            @location(0) normal: vec3<f32>,
            @location(1) texcoord: vec2<f32>,
          };

          @vertex
          fn myVSMain(v: MyVSInput) -> MyVSOutput {
            var vsOut: MyVSOutput;
            vsOut.position = vsUniforms0.worldViewProjection * v.position;
            vsOut.normal = (vsUniforms1.worldInverseTranspose * vec4<f32>(v.normal, 0.0)).xyz;
            vsOut.texcoord = v.texcoord;
            return vsOut;
          }

          @fragment
          fn myFSMain(v: MyVSOutput) -> @location(0) vec4<f32> {
            return vec4f(0);
          }
          `;

        const shaderModule = device.createShaderModule({code: shaderSrc});
        const pipelineDesc = {
          layout: 'auto',
          vertex: {
            module: shaderModule,
            entryPoint: 'myVSMain',
            buffers: [
              { arrayStride: 3 * 4, attributes: [ {shaderLocation: 0, offset: 0, format: 'float32x3'}, ], },
              { arrayStride: 3 * 4, attributes: [ {shaderLocation: 1, offset: 0, format: 'float32x3'}, ], },
              { arrayStride: 2 * 4, attributes: [ {shaderLocation: 2, offset: 0, format: 'float32x2',}, ], },
            ],
          },
          fragment: {
            module: shaderModule,
            entryPoint: 'myFSMain',
            targets: [ {format: 'rgba8unorm'}, ],
          },
        };
        pipeline0 = device.createRenderPipeline(pipelineDesc);
        pipeline1 = device.createRenderPipeline(pipelineDesc);

        const vsUniformBuffer0 = device.createBuffer({
          size: 1024,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        const vsUniformBuffer1 = device.createBuffer({
          size: 1024,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        bindGroup0 = device.createBindGroup({
          label: 'group0',
          layout: pipeline0.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: vsUniformBuffer0 } },
            { binding: 2, resource: { buffer: vsUniformBuffer1 } },
          ],
        });
        bindGroup1 = device.createBindGroup({
          label: 'group1',
          layout: pipeline0.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: vsUniformBuffer0 } },
            { binding: 2, resource: { buffer: vsUniformBuffer1 } },
          ],
        });

        const bindGroupLayout = device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform", hasDynamicOffset: true } },
            { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform", hasDynamicOffset: true } },
          ],
        });
        dynamicBindGroup0 = device.createBindGroup({
          label: 'dynamicGroup0',
          layout: bindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: vsUniformBuffer0, size: 512 } },
            { binding: 2, resource: { buffer: vsUniformBuffer1, size: 512 } },
          ],
        });
        dynamicBindGroup0 = device.createBindGroup({
          label: 'dynamicGroup1',
          layout: bindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: vsUniformBuffer0, size: 512 } },
            { binding: 2, resource: { buffer: vsUniformBuffer1, size: 512 } },
          ],
        });

        vertexBuffer0 = device.createBuffer({ size: 128, usage: GPUBufferUsage.VERTEX });
        vertexBuffer1 = device.createBuffer({ size: 128, usage: GPUBufferUsage.VERTEX });
        indexBuffer0 = device.createBuffer({ size: 128, usage: GPUBufferUsage.INDEX });
        indexBuffer1 = device.createBuffer({ size: 128, usage: GPUBufferUsage.INDEX });

        const tex = device.createTexture({
          size: [2, 2, 1],
          format: 'rgba8unorm',
          usage: GPUTextureUsage.RENDER_ATTACHMENT
        });
        renderPassDescriptor = {
          colorAttachments: [
            {
              view: tex.createView(),
              clearValue: [0, 0, 0, 0],
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
        };

        pass = encoder.beginRenderPass(renderPassDescriptor);
      });

      after(() => {
        pass.end();
      });

      beforeEach(() => {
        getAndResetRedundantCallInfo();
      });

      it('setPipeline', () => {
        testSetPipeline(pass, pipeline0, pipeline1);
      });

      it('setBindGroup', () => {
        testSetBindGroup(pass, bindGroup0, bindGroup1, dynamicBindGroup0, dynamicBindGroup1);
      });

      it('setVertexBuffer', () => {
        const tests = [
          { args: [0, vertexBuffer0], same: false },
          { args: [0, vertexBuffer0], same: true },
          { args: [0, vertexBuffer0, 0], same: true },
          { args: [0, vertexBuffer0, 0, vertexBuffer0.size], same: true },
          { args: [0, vertexBuffer0, 0, vertexBuffer0.size - 4], same: false },
          { args: [0, vertexBuffer0, 4, vertexBuffer0.size - 4], same: false },
          { args: [0, vertexBuffer1, 4, vertexBuffer0.size - 4], same: false },
        ];
        for (const {args, same} of tests) {
          pass.setVertexBuffer(...args);
          const info = getAndResetRedundantCallInfo();
          assertEqual(info.setVertexBuffer, same ? 1 : 0, `setVertexBuffer: ${args.join(', ')}`);
        }
      });

      it('setIndexBuffer', () => {
        const tests = [
          { args: [indexBuffer0, 'uint16'], same: false },
          { args: [indexBuffer0, 'uint16'], same: true },
          { args: [indexBuffer0, 'uint16', 0], same: true },
          { args: [indexBuffer0, 'uint16', 0, indexBuffer0.size], same: true },
          { args: [indexBuffer0, 'uint16', 0, indexBuffer0.size - 4], same: false },
          { args: [indexBuffer0, 'uint16', 4, indexBuffer0.size - 4], same: false },
          { args: [indexBuffer1, 'uint16', 4, indexBuffer0.size - 4], same: false },
          { args: [indexBuffer1, 'uint32', 4, indexBuffer0.size - 4], same: false },
        ];
        for (const {args, same} of tests) {
          pass.setIndexBuffer(...args);
          const info = getAndResetRedundantCallInfo();
          assertEqual(info.setIndexBuffer, same ? 1 : 0, `setIndexBuffer: ${args.join(', ')}`);
        }
      });

      it('setViewport', () => {
        const viewports = [
          [0, 0, 1, 1, 0, 1],
          [1, 0, 1, 1, 0, 1],
          [1, 1, 1, 1, 0, 1],
          [1, 1, 0, 1, 0, 1],
          [1, 1, 0, 0, 0, 1],
          [1, 1, 0, 0, 0.5, 1],
          [1, 1, 0, 0, 0.5, 0.6],
          [1, 1, 0, 0, 0.5, 0.6],
        ];
        for (let i = 0; i < viewports.length; ++i) {
          const viewport = viewports[i];
          pass.setViewport(...viewport);
          const info = getAndResetRedundantCallInfo();
          assertEqual(info.setViewport, i === viewports.length - 1 ? 1 : 0, `viewport: ${viewport.join(', ')}`);
        }
      });

      it('setScissor', () => {
        const scissors = [
          [0, 0, 1, 1],
          [1, 0, 1, 1],
          [1, 1, 1, 1],
          [1, 1, 0, 1],
          [1, 1, 0, 1],
        ];
        for (let i = 0; i < scissors.length; ++i) {
          const scissor = scissors[i];
          pass.setScissorRect(...scissor);
          const info = getAndResetRedundantCallInfo();
          assertEqual(info.setScissorRect, i === scissors.length - 1 ? 1 : 0, `scissor: ${scissor.join(', ')}`);
        }
      });

      it('setBlendConstant', () => {
        const constants = [
          { constant: [0, 0, 1, 1], same: false },
          { constant: [1, 0, 1, 1], same: false },
          { constant: [1, 1, 1, 1], same: false },
          { constant: [1, 1, 0, 1], same: false },
          { constant: [1, 1, 0, 1], same: true },
          { constant: { r: 0, g: 0, b: 1, a: 1 }, same: false },
          { constant: { r: 1, g: 0, b: 1, a: 1 }, same: false },
          { constant: { r: 1, g: 1, b: 1, a: 1 }, same: false },
          { constant: { r: 1, g: 1, b: 0, a: 1 }, same: false },
          { constant: { r: 1, g: 1, b: 0, a: 1 }, same: true },
          { constant: [1, 1, 0, 1], same: true },
          { constant: { r: 1, g: 1, b: 0, a: 1 }, same: true },
        ];
        for (const {constant, same} of constants) {
          pass.setBlendConstant(constant);
          const info = getAndResetRedundantCallInfo();
          assertEqual(info.setBlendConstant, same ? 1 : 0, `blendConstant: ${JSON.stringify(constant)}`);
        }
      });

      it('setStencilReference', () => {
        const references = [
          128,
          128,
        ];
        for (let i = 0; i < references.length; ++i) {
          const reference = references[i];
          pass.setStencilReference(reference);
          const info = getAndResetRedundantCallInfo();
          assertEqual(info.setStencilReference, i === references.length - 1 ? 1 : 0, `stencilReference: ${reference} (${i})`);
        }
      });
    });

  });

});
