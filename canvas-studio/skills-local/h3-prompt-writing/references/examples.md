# 官方 IR 完整对照（四组 few-shot）

这四组是**官方 H3-Context-IR 系统的真实输入输出**，来自 MiniMax 公开发布的
仓库脚本与 API 文档。拿不准怎么写的时候，照着最接近的那一组写。

| id | 模式 | 时长 | ratio | 看点 |
|---|---|---|---|---|
| A1 | T2VA | 10s | `16:9` | 双镜头，切镜点 45%；无台词 |
| A2 | I2VA | 8s | `adaptive` | 对齐行 + **单镜头零切镜**；533 词的高密度描述 |
| A3 | Ref2VA | 5s | `adaptive` | 六段式；video editing + 音频复用/引用；含台词 |
| A4 | T2VA | 5s | `16:9` | **与 A1 同一意图的 5 秒版**，切镜点 56% |

**A1 与 A4 是同一段输入文本的两个时长版本**，对照它们能看出 IR 如何随时长
重排时间结构：10 秒版切在 `00:04.500`，5 秒版切在 `00:02.800`。
两版的镜头数相同（都是 2 个），变的是切点位置和每镜头的信息量。

**A2 是"图不等于 Ref2VA"的关键反例**：输入带一张 `role=first_frame` 的图，
官方输出是**对齐行 + 三段式**，不是六段式。

---

## A1-t2va-space-10s

**模式** T2VA ｜ **duration** 10 ｜ **ratio** `16:9`

### 输入（用户原始意图）

- `text`: Epic space-opera theatrical teaser: a female captain stands alone before a massive observation window as the last fleet gathers and jumps away in a blinding flash, the bridge shaking, leaving her behind.

### 输出（官方 IR）

```text
integrated_multimodal_description: [Shot 1] Cinematic, medium wide shot, pushing in slowly. In the cavernous, dimly lit bridge of a starship, sleek metallic consoles with glowing amber displays flank a massive, curved observation window. A female captain, in her late 40s with an athletic build and short silver-streaked black hair, stands in the center midground. She wears a structured, high-collared dark navy military tunic with silver chest insignias. Her back is to the camera, silhouetted against the cool, ambient starlight pouring through the thick glass. She stands perfectly still with her hands clasped tightly behind her back. Outside the window, a massive armada of jagged, dark grey dreadnoughts hovers in tight formation against a deep purple space nebula. The fleet's massive rear thrusters begin to glow with an intense, escalating bright blue light. [Shot 2] At 00:04.500, the camera cuts to a close-up of the captain's face and shakes strongly. The brilliant blue-white light from the fleet's gathering energy reflects vividly in her dark eyes. Suddenly, a blinding white flash floods through the window, completely washing out the background as the fleet jumps to hyperspace. The sheer spatial force violently jolts the bridge, causing the captain from Shot 1 to stagger slightly forward, her shoulders tensing as she visibly braces herself against the physical tremors. As the intense white light fades abruptly, leaving only the dim, empty expanse of the purple nebula reflected on her starkly lit skin, her jaw clenches, and she slowly closes her eyes in the newly emptied space.
overall_soundscape: A low, resonant hum of the ship's ambient life support systems serves as the baseline, soon drowned out by an audible, escalating, high-pitched electronic whine as the fleet outside charges its hyperdrives. A massive, deafening, bass-heavy boom and sharp crackle erupts during the blinding flash, accompanied by the loud metallic creaking, rattling, and deep thuds of the bridge's bulkheads vibrating under immense physical stress. The intense roaring impact then cuts abruptly back to a hollow, echoing room tone, leaving only the faint, steady hum of the isolated bridge.
non_diegetic_music: Cinematic space-opera orchestral score, slow tempo, featuring a solitary, mournful French horn melody over deep, sustained string dissonances that build rapidly in volume and intensity, swelling to a massive orchestral peak before snapping immediately into silence right after the jump.
```

---

## A2-i2va-ramen-8s

**模式** I2VA ｜ **duration** 8 ｜ **ratio** `adaptive`

### 输入（用户原始意图）

- `text`: Pull focus to the people in the background and add more steam to the ramen bowl.
- `image_url` role=`first_frame`: `https://cdn.hailuoai.com/prod/hailuo_demo/testsets/H3_AA_I2VA/gallery/sr_v17_variants_seed42_43_20260724/inputs/4a3a90bf9100_KDmcbkhzYo5sjjxr9FqcVmWVnzb.png`

### 输出（官方 IR）

```text
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.

integrated_multimodal_description: [Shot 1] This is a live-action, cinematic shot with a shallow depth of field. The camera holds a perfectly static shot throughout the entire eight-second duration, capturing a cozy family gathering in a traditional Japanese dining room. The scene opens with a large, intricately patterned blue and white ceramic bowl of ramen in the immediate foreground, rendered in crisp, sharp focus. The bowl sits on a smooth, polished long wooden table. Inside the bowl, a rich, oily golden-brown broth surrounds yellow wavy noodles, topped with two thick, round slices of chashu pork featuring visible fat marbling and a distinct spiral meat pattern. A generous mound of freshly chopped, bright green scallions rests in the center, and a crisp, dark green rectangular sheet of nori seaweed is tucked into the right edge. To the left of the bowl, a pair of light brown wooden chopsticks rests horizontally on a small, dark rectangular chopstick rest, near a small cylindrical ceramic teacup with blue painted patterns. On the right side of the table, a spherical paper lantern with a ribbed bamboo frame sits on a black wooden base. In the background, a large family of seven is gathered around the table, initially appearing as a soft, blurred presence. Behind them, traditional Japanese sliding shoji screens with wooden lattice frames are open, revealing a bright outdoor scene with lush green trees. Early in the clip, the thick, white steam rising from the hot ramen broth immediately intensifies, billowing upwards in thick, swirling clouds that dance continuously above the bowl. As the clip progresses into the middle seconds, the camera maintains its static position while the focus begins a deliberate, smooth shift deeper into the room. The foreground ramen bowl, its vibrant ingredients, and the rising steam gradually soften into a hazy, out-of-focus blur. Simultaneously, the family members in the background come into sharp, detailed clarity. The heavy steam continues to rise from the foreground, creating a dynamic, translucent veil between the camera and the family. With the focus now firmly locked on the background, the vibrant family dinner comes alive. The man in the dark navy blue long-sleeved shirt on the left leans forward, his mouth moving animatedly in a silent exchange. The young girl in the crisp white short-sleeved t-shirt beside him smiles brightly, looking toward the center of the table. The woman on the far left, wearing a soft light blue long-sleeved blouse, turns her head slightly, smiling gently. Across the table, the woman in the light grey button-down shirt smiles broadly, her eyes crinkling, as she rests her hands near her plate. The woman in the dark grey top further back uses her wooden chopsticks to pick up a small piece of food from a central ceramic dish filled with bright red pickled vegetables. The woman in the center back in the light grey sweater smiles gently, her hands clasped softly in front of her, observing the interaction. Throughout the remainder of the clip, the family continues their lively physical interaction, their mouths moving in continuous, silent cadences of conversation, while the thick, white steam from the blurred ramen bowl in the foreground never stops rising, adding a comforting atmosphere to the warm gathering.

overall_soundscape: The soundscape begins with a quiet room tone mixed with the faint, airy rustle of the thick steam billowing from the hot ramen bowl in the foreground, accompanied by the subtle, continuous hissing and bubbling of the rich broth. As the visual focus shifts deeper into the room, the physical sounds of the bustling family dinner become dominant in the foreground. The clear, sharp clinking of ceramic bowls and wooden chopsticks touching plates is clearly heard as the family members reach for food. This is followed by the faint, muffled thud of a cup being set down on the smooth wooden table, and the subtle, rhythmic rustle of cotton and wool clothing as the family members lean forward and gesture, perfectly capturing the lively, physical atmosphere of the shared meal.

non_diegetic_music: A gentle, heartwarming acoustic guitar melody plays softly in the background, accompanied by the subtle, resonant notes of a traditional Japanese koto. The music maintains a slow, comforting tempo that enhances the cozy, nostalgic, and joyful atmosphere of the family gathering.
```

---

## A3-ref2va-lamb-5s

**模式** Ref2VA ｜ **duration** 5 ｜ **ratio** `adaptive`

### 输入（用户原始意图）

- `text`: Character speaks: Follow the wind, live free. Leave worries behind, enjoy the moment. Voice timbre follows reference audio 1.
- `video_url` role=`reference_video`: `https://cdn.hailuoai.com/prod/hailuo_demo/testsets/h3_promo_eval_ref2va/gallery/sr_v2p26_trio_seed42_20260724/inputs/297573323635_00_%E8%A7%86%E9%A2%911_YnyRbxEwio_video_20260525_163755_1927e9d3.mp4`
- `audio_url` role=`reference_audio`: `https://cdn.hailuoai.com/prod/hailuo_demo/testsets/h3_promo_eval_ref2va/gallery/sr_v2p26_trio_seed42_20260724/inputs/f463d523c5ce_01_%E9%9F%B3%E9%A2%911_RSLcbpzJPo_6%E6%9C%885%E6%97%A5(1).mp3`

### 输出（官方 IR）

```text
subject_definitions:
<Subject 1> is the young man with short wavy blonde hair, wearing a bright pink suit jacket, matching pink trousers, an unbuttoned white shirt, and silver rings, holding a small black lamb in his arms in <Video 1>.
<Video 1> is the source video for the editing task.
<Audio 1> is the synchronized audio track of <Video 1>, providing the background music.
<Audio 2> is the voice timbre reference for <Subject 1>'s voice, containing a spoken male voiceover.

summary:
[video editing + audio reference + audio reuse] The target video is an edited version of <Video 1>. <Subject 1>, wearing a bright pink suit and holding a black lamb, stands in a grassy field with other white lambs in the background. The edit animates <Subject 1>'s face to speak the user-provided dialogue. <Audio 1> is partially reused as the continuous background music, while the target references the calm male voice timbre of <Audio 2> for <Subject 1>'s spoken lines.

retention_analysis:
<Subject 1> (appears in [Shot 1]): fully_preserved - the man retains his identity, wavy blonde hair, pink suit, white shirt, accessories, and the black lamb he holds, with his mouth newly animated to speak.
<Video 1> (source video editing): fully_preserved - the original camera framing, warm golden hour lighting, grassy hill setting, and background white lambs are maintained while the central character is edited.
<Audio 1>: partially_copy - the atmospheric background music from <Audio 1> is reused in the target video, mixed beneath the newly added spoken dialogue.
<Audio 2>: reference - the target audio references the male voice timbre from <Audio 2> to generate <Subject 1>'s spoken dialogue.

detailed_description:
The target video is in realistic photographic style.
[Shot 1] The shot begins from the source <Video 1>, showing <Subject 1>, a young man with short wavy blonde hair, wearing a bright pink suit jacket, matching pink trousers, and a casually unbuttoned white shirt. He stands confidently in a sunlit green pasture, gently holding a small black lamb securely in his arms. The warm, golden hour lighting casts soft shadows across his face and the bright pink fabric of his suit. Behind him, several white lambs stand and graze on the rolling grassy hill against a clear, pale blue sky. The atmospheric background music from <Audio 1> plays continuously throughout the scene. <Subject 1> physically speaks, his mouth movements naturally syncing to the new dialogue, with his voice timbre referencing the calm male delivery from <Audio 2>. Looking thoughtfully forward, <Subject 1> (S1) speaks softly, <d>[English] Follow the wind, live free.</d> As he delivers the line, he subtly shifts his weight, cradling the resting black lamb while the camera slowly pushes in. <Subject 1> (S1) continues his thought, <d>[English] Leave worries behind, enjoy the moment.</d> Exactly as his voice stops, his lips meet in a relaxed, peaceful smile, and his jaw ceases speaking motion. He then turns his gaze slightly away toward the horizon, gently stroking the black lamb's fleece with his fingers as the camera holds on this tranquil, sunlit state through the end of the video.

overall_soundscape:
The soundscape consists of the continuous, atmospheric background music from <Audio 1>, overlaid with the clear, calm male dialogue spoken by the main character, referencing the voice timbre of <Audio 2>.

non_diegetic_music:
The atmospheric, sustained background music from <Audio 1> is reused as the continuous score, playing quietly beneath the spoken dialogue.
```

---

## A4-t2va-space-5s

**模式** T2VA ｜ **duration** 5 ｜ **ratio** `16:9`

### 输入（用户原始意图）

- `text`: Epic space-opera theatrical teaser: a female captain stands alone before a massive observation window as the last fleet gathers and jumps away in a blinding flash, the bridge shaking, leaving her behind.

### 输出（官方 IR）

```text
integrated_multimodal_description: [Shot 1] Cinematic, wide shot with a slow push in on a female captain standing center frame with her back to the camera. She has a slender build and short, swept-back silver hair, wearing a crisp, dark navy-blue futuristic military uniform adorned with rigid silver epaulets. Before her stretches a colossal, curved glass observation window dominating the dimly lit starship bridge. The interior features sleek metallic consoles on the left and right emitting soft cyan light. Outside the window, a massive fleet of dark-grey, heavily armored dreadnoughts and cruisers is assembling against a backdrop of a swirling deep-purple and magenta nebula. The rear thrusters of the distant ships glow intensely with fiery orange light. [Shot 2] At 00:02.800, the camera cuts to a medium close-up of the captain from Shot 1 in profile facing right, while the camera shakes strongly. Her facial features are now visible, revealing a woman in her late forties with sharp cheekbones and a stoic expression. A sudden, blinding flash of brilliant cyan and white light bursts through the window as the fleet outside simultaneously jumps into warp, casting harsh, overexposed illumination across her face. The bridge vibrates violently, causing her shoulders to tense and her uniform collar to tremble. The intense light instantly fades into deep shadow, leaving her completely alone against the newly emptied, pitch-black void of space.
overall_soundscape: Deep, resonant low-frequency thrumming of ship engines, overlaid with rhythmic, high-pitched electronic beeps from the consoles, followed by a sudden, deafening sub-bass boom and a loud, sizzling crackle as the warp drives engage. The immense acoustic impact causes a heavy, metallic clattering of the bridge panels, which instantly drops off into a stark, quiet mechanical hum.
non_diegetic_music: Symphonic orchestral score, beginning with a slow, rising brass and string crescendo that abruptly cuts off, instantly transitioning into a single, sustained, low-register solo cello note with no dynamic swell.
```

---
