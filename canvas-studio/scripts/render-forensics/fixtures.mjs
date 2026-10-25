/** 真实素材与项目资产前缀（scenarios 与 cards 共用，避免循环 import）。 */
/** 会话里真实用到的三个素材（同目录）。缺失时相关场景自动跳过。 */
export const REAL_ASSETS = {
  image: 'watch-hero.png',            // 会话中已被删；服务端会回退到源图
  imageFallback: '4b4283d5-3c38-4036-a22e-01bf667085d8.png',
  video: '76559d60-9bf9-423a-a797-981e10cd56f1.mp4', // 首渲成功的那条 9.07s 片段
  audio: 'a3ca636c-7880-4516-8a20-81c3b60c5c22.mp3', // 第 1 句旁白 5s
  bgm: 'ef337d77-98d0-457b-9ba0-91167c6269e7.mp3',
}

export const PROJECT_ASSET_PREFIX = '/canvas-studio/assets/e02ba1ca-37f4-47c6-b324-e4ff743f3b43/'

