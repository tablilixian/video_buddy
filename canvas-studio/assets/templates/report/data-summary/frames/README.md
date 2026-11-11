参考帧基线目录。

- 文件名 = **帧号**（`540.png`），渲染后与这些基线比对即可看出「模板效果有没有走样」。
- 目前**为空**：基线需要真机渲染产出（本仓 CI 无浏览器）。模板不依赖它 —— 缺帧时比对直接跳过。
- 生成方式：用 `scaffold_manifest({ templateId, slots: <slots.json 里的 example> })` 出片，
  再从成片抽帧（`render_composition({ spotFrames: [...] })`）另存到这里。
