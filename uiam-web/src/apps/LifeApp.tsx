/**
 * 生活应用：点桌面上的天气 / 日历 / 时钟卡片时打开的详情窗口。
 *
 * 这里不重写一套渲染，而是复用桌面卡片的 `WidgetBody`（xl 档），保证窗口里
 * 看到的数字和小组件是同一份真实数据；天气城市也共用同一份本机选择。
 */
import { WidgetBody } from '../shell/widgets'

export function LifeApp() {
  return (
    <div className="pane life-app">
      <div className="pane-head">
        <div>
          <div className="pane-title">生活</div>
          <div className="pane-desc">天气、日历与时钟 · 与桌面组件共用同一份数据</div>
        </div>
      </div>

      <div className="life-grid">
        <section className="life-card wide weather">
          <WidgetBody id="weather" size="large" />
        </section>
        <section className="life-card calendar">
          <WidgetBody id="calendar" size="xl" />
        </section>
        <section className="life-card clock">
          <WidgetBody id="clock" size="large" />
        </section>
        <section className="life-card clock-digital">
          <WidgetBody id="clock-digital" size="small" />
        </section>
      </div>

      <p className="hint" style={{ marginTop: 12 }}>
        天气来自 Open-Meteo 公共接口（在天气卡片右上角切换城市，或只填城市名添加自定义城市），断网时显示最后一次成功抓取的缓存；
        日历与时钟使用本机日期时间。
      </p>
    </div>
  )
}
