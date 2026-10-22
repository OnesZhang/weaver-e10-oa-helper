/**
 * E10 Helper - MAIN World Inject Script
 * 运行在页面上下文中，可直接访问 weappUtils 等全局对象
 */
(function () {
  'use strict';

  // 监听来自 content.js 的消息
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.type !== 'E10_HELPER_INJECT') return;

    if (event.data.action === 'unlockEsbLoggerCheckbox') {
      unlockEsbLoggerCheckbox();
    }
  });

  function unlockEsbLoggerCheckbox() {
    if (typeof weappUtils === 'undefined' || !weappUtils.regOvProps) {
      console.warn('[E10 Helper] weappUtils.regOvProps not available');
      return;
    }

    weappUtils.regOvProps('weappUi', 'Table', function (props) {
      if (props.className && props.className.includes('weapp-esb-setting-app-logger-table') && props.selection) {
        const sel = props.selection;
        const origGetSelectionProps = sel.getSelectionProps;
        sel.getSelectionProps = function (rowInfo) {
          const result = origGetSelectionProps.call(this, rowInfo);
          result.disabled = false;
          return result;
        };
      }
      return props;
    }, 0);

    console.log('[E10 Helper] ESB Logger checkbox unlock injected');
  }
})();
