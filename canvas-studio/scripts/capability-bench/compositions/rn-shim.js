/**
 * react-native 浏览器垫片（02S 真 Skia 冒烟专用）。
 * @shopify/react-native-skia 的 web 变体在 Platform.web.js 里有一个条件
 * `require("react-native/Libraries/Image/AssetRegistry")`，webpack 仍会静态解析 ——
 * 浏览器 bundle 里没有 react-native，run.mjs 的 webpackOverride 把这个请求与
 * `react-native` 本体都别名到本文件的空实现（registerAsset 只需返回带 getId 的对象）。
 */
export const registerAsset = () => ({ getId: () => 'rn-shim-stub', scaffold: undefined })
const StubImage = () => null
StubImage.displayName = 'RNShimStubImage'
const StubView = () => null
StubView.displayName = 'RNShimStubView'
export { StubImage as Image, StubView as View }
const PixelRatio = { get: () => 1 }
const Platform = { OS: 'web', select: (spec) => spec.web ?? spec.default }
const findNodeHandle = () => null
export { PixelRatio, Platform, findNodeHandle }
export default { registerAsset, PixelRatio, Platform, findNodeHandle, Image: StubImage, View: StubView }
