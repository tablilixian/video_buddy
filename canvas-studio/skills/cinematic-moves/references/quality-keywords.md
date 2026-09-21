# 通用画质与质感关键词

在任何运镜 prompt 后追加这些关键词，提升画面质感。

---

## 中文关键词

| 类别 | 关键词 |
|------|--------|
| 画质 | 电影级质感，细节丰富，4K/8K，高清画质 |
| 运动 | 自然运动，流畅不卡顿，稳定流畅，帧率顺滑 |
| 光影 | 光影唯美，色彩电影感，浅景深，运动模糊自然 |
| 氛围 | 电影感，叙事感，沉浸感，氛围感 |

---

## 英文关键词

| 类别 | 关键词 |
|------|--------|
| 画质 | cinematic quality, rich details, 4K/8K, high definition |
| 运动 | natural movement, smooth motion, stable, fluid frame rate |
| 光影 | cinematic lighting, film grain, shallow depth of field, natural motion blur |
| 氛围 | cinematic feel, narrative atmosphere, immersive, atmospheric |

---

## 推荐组合

### 基础组合（任何场景）
```
电影级质感，细节丰富，自然运动，浅景深，cinematic lighting，4K，稳定流畅
```

### 战斗场景
```
电影级质感，细节丰富，运动模糊自然，冲击力强，cinematic lighting，4K，动态流畅
```

### 情感场景
```
电影级质感，细节丰富，光影唯美，色彩电影感，浅景深，cinematic lighting，4K，稳定流畅
```

### 奇幻场景
```
电影级质感，细节丰富，自然运动，光影唯美，色彩电影感，cinematic lighting，4K/8K，稳定流畅
```

---

## 使用注意

1. **不要堆砌**：选择 3-5 个最相关的关键词即可
2. **保持一致**：同一项目的画风、光影、质感要锁死
3. **配合运镜**：画质关键词放在运镜描述之后
4. **H3兼容**：英文关键词可直接用于 H3 IR 的 `integrated_multimodal_description`

---

## 与 H3 IR 的关系

在 H3-Context-IR 中，这些关键词通常放在：
- `integrated_multimodal_description` 的末尾（三段式）
- `detailed_description` 的末尾（六段式）

**示例**：
```
[Shot 1] The camera pushes in with small amplitude at slow speed toward the character...
Cinematic quality, rich details, shallow depth of field, cinematic lighting, 4K.
```
