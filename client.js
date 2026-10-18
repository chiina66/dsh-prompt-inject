/* dsh-prompt-inject —— 客户端半区
 *
 * 在设置面板里挂一个「提示词注入」分区：
 *   - 开关：注入是否启用
 *   - 文本域：直接编辑要注入的系统提示词（内联 content）
 *   - 保存 / 清空 / 重新读取
 *
 * 读写走 ctx.configForms.get('prompt-inject')：这是 dsh-client-ui-settings 提供的
 * 共享配置表单控制器，底层经 remote.settings 打到 Host 的 volatile 配置，
 * Host 再持久化进 profile 的 cordis.patch.yml。保存后插件条目重配，
 * 注入内容在下一回合就被读进系统提示词。
 *
 * 手写 bundle：不经过 tsdown，直接给浏览器提供 factory，只 require 平台模块表里的 react。
 */
window.__ModuleLoader__.load({
  id: 'dsh-prompt-inject',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    var React = require('react');
    var h = React.createElement;

    /** 设置命名空间 = Loader 条目 id（cordis.patch.yml 里的 id: prompt-inject）。 */
    var NS = 'prompt-inject';

    var S = {
      root: {
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        padding: '4px 2px 24px',
        fontFamily: 'inherit',
        fontSize: '13px',
        lineHeight: '1.65',
        color: 'inherit',
      },
      title: { margin: '0', fontSize: '15px', fontWeight: '600' },
      hint: { margin: '0', opacity: '0.7', fontSize: '12px' },
      row: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
      pill: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '2px 10px',
        borderRadius: '999px',
        border: '1px solid rgba(127,127,127,0.3)',
        fontSize: '12px',
      },
      dot: { width: '7px', height: '7px', borderRadius: '50%', background: 'currentColor', opacity: '0.75' },
      area: {
        width: '100%',
        boxSizing: 'border-box',
        minHeight: '260px',
        resize: 'vertical',
        padding: '12px',
        borderRadius: '8px',
        border: '1px solid rgba(127,127,127,0.28)',
        background: 'rgba(127,127,127,0.06)',
        color: 'inherit',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: '12.5px',
        lineHeight: '1.6',
        outline: 'none',
      },
      button: {
        padding: '6px 14px',
        borderRadius: '6px',
        border: '1px solid rgba(127,127,127,0.32)',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        fontSize: '12.5px',
        cursor: 'pointer',
      },
      primary: {
        padding: '6px 16px',
        borderRadius: '6px',
        border: '1px solid rgba(59,130,246,0.5)',
        background: 'rgba(59,130,246,0.16)',
        color: 'inherit',
        font: 'inherit',
        fontSize: '12.5px',
        fontWeight: '600',
        cursor: 'pointer',
      },
      disabled: { opacity: '0.45', cursor: 'not-allowed' },
      note: { margin: '0', fontSize: '12px', minHeight: '16px', opacity: '0.85' },
      warn: {
        margin: '0',
        fontSize: '12px',
        padding: '8px 10px',
        borderRadius: '6px',
        border: '1px solid rgba(234,179,8,0.35)',
        background: 'rgba(234,179,8,0.08)',
      },
      meta: { fontSize: '12px', opacity: '0.7' },
    };

    /** 订阅共享配置表单的草稿/已接受值。 */
    function useFormSnapshot(form) {
      // React 18 有 useSyncExternalStore；更老的运行时退回 state + effect。
      var useSync = React.useSyncExternalStore;
      var subscribe = React.useCallback(
        function (listener) { return form.subscribe(listener); },
        [form],
      );
      var read = React.useCallback(function () { return form.getSnapshot(); }, [form]);
      if (typeof useSync === 'function') return useSync(subscribe, read);
      var state = React.useState(read());
      var value = state[0];
      var setValue = state[1];
      React.useEffect(function () {
        return subscribe(function () { setValue(read()); });
      }, [subscribe]);
      React.useEffect(function () { setValue(read()); });
      return value;
    }

    var EMPTY = {};

    /**
     * 设置分区组件。
     * @param props - `inject` 提供的 `form`（ConfigFormController）。
     */
    function PromptInjectSection(props) {
      var form = props.form || currentForm;
      if (!form) {
        return h('div', { style: S.root },
          h('h2', { style: S.title }, '提示词注入'),
          h('p', { style: S.warn }, '配置服务还没就绪（configForms 不可用），稍后再打开这个页面试试。'));
      }
      var snap = useFormSnapshot(form) || EMPTY;
      var value = snap.value || EMPTY;
      var ready = Boolean(snap.value);
      var writable = snap.writable !== false;

      var contentState = React.useState('');
      var draft = contentState[0];
      var setDraft = contentState[1];
      var dirtyState = React.useState(false);
      var dirty = dirtyState[0];
      var setDirty = dirtyState[1];
      var busyState = React.useState(false);
      var busy = busyState[0];
      var setBusy = busyState[1];
      var noteState = React.useState('');
      var note = noteState[0];
      var setNote = noteState[1];
      var initedRef = React.useRef(false);

      var hostContent = typeof value.content === 'string' ? value.content : '';
      var enabled = value.enabled !== false;
      var contentFile = typeof value.contentFile === 'string' ? value.contentFile : '';

      // 首次拿到 Host 值填草稿；之后只在用户没有未保存改动时跟随 Host
      React.useEffect(function () {
        if (!ready) return;
        if (!initedRef.current) {
          initedRef.current = true;
          setDraft(hostContent);
          return;
        }
        if (!dirty) setDraft(hostContent);
      }, [ready, hostContent, dirty]);

      /** 跑一次写操作，把结果写进提示行；返回 Host 是否接受。 */
      function run(action, label) {
        if (busy || !writable) return Promise.resolve(false);
        setBusy(true);
        setNote('正在' + label + '…');
        return Promise.resolve()
          .then(action)
          .then(function (ok) {
            setNote(ok ? label + '成功，下一回合生效' : label + '被 Host 拒绝，已回读最新值');
            return ok === true;
          })
          .catch(function (error) {
            setNote(label + '失败：' + String((error && error.message) || error));
            return false;
          })
          .then(function (ok) {
            setBusy(false);
            return ok;
          });
      }

      function handleSave() {
        var text = draft;
        run(function () {
          return form.mutate([
            { op: 'set', path: ['content'], value: text },
            { op: 'set', path: ['contentFile'], value: '' },
          ]);
        }, '保存').then(function (ok) {
          if (ok) setDirty(false);
        });
      }

      function handleClear() {
        setDraft('');
        setDirty(false);
        run(function () {
          return form.mutate([
            { op: 'set', path: ['content'], value: '' },
            { op: 'set', path: ['contentFile'], value: '' },
          ]);
        }, '清空');
      }

      function handleToggle() {
        var next = !enabled;
        run(function () { return form.set('enabled', next); }, next ? '启用' : '停用');
      }

      function handleReload() {
        setDirty(false);
        setDraft(hostContent);
        setNote('已按 Host 当前值重新读取');
      }

      var chars = draft.length;

      return h('div', { style: S.root },
        h('div', { style: S.row },
          h('h2', { style: S.title }, '提示词注入'),
          h('span', { style: S.pill },
            h('span', { style: S.dot, 'aria-hidden': 'true' }),
            enabled ? '已启用' : '已停用'),
          ready ? null : h('span', { style: S.meta }, '（正在读取 Host 配置…）'),
        ),
        h('p', { style: S.hint },
          '这里的文字会作为一段系统提示词，插在 Harness 身份之后、人格与工具说明之前，',
          '当前会话、子代理、工作流都会带上它。保存后下一回合生效，不用刷新页面。'),

        contentFile
          ? h('p', { style: S.warn },
            '当前配置还在读文件：' + contentFile + '。文件存在时它优先于这里的内容。',
            '在上面点「保存」会改用内联正文并清空该字段。')
          : null,

        !writable
          ? h('p', { style: S.warn }, '这项配置被上层 patch（home 或命令行 overlay）覆盖，界面里改不动。')
          : null,

        h('textarea', {
          style: S.area,
          value: draft,
          spellCheck: false,
          disabled: !writable,
          placeholder: '例如：回复尽量简短；代码注释用中文；不确定的事情先说不确定。',
          onChange: function (event) {
            setDraft(event.target.value);
            setDirty(true);
            setNote('');
          },
        }),

        h('div', { style: S.row },
          h('button', {
            type: 'button',
            style: busy || !writable ? Object.assign({}, S.primary, S.disabled) : S.primary,
            disabled: busy || !writable,
            onClick: handleSave,
          }, dirty ? '保存修改' : '保存'),
          h('button', {
            type: 'button',
            style: busy || !writable ? Object.assign({}, S.button, S.disabled) : S.button,
            disabled: busy || !writable,
            onClick: handleToggle,
          }, enabled ? '停用注入' : '启用注入'),
          h('button', {
            type: 'button',
            style: busy || !writable ? Object.assign({}, S.button, S.disabled) : S.button,
            disabled: busy || !writable,
            onClick: handleClear,
          }, '清空'),
          h('button', {
            type: 'button',
            style: busy ? Object.assign({}, S.button, S.disabled) : S.button,
            disabled: busy,
            onClick: handleReload,
          }, '重新读取'),
          h('span', { style: S.meta }, chars + ' 字符' + (dirty ? '（有未保存的修改）' : '')),
        ),

        h('p', { style: S.note }, note),
        h('p', { style: S.hint },
          '注入内容存在 profile 的 cordis.patch.yml 里（条目 prompt-inject 的 config.content）。',
          '想改成读文件，把 contentFile 指到某个 .md 即可，插件每回合都会重新读它。'),
      );
    }

    var inject = ['slots', 'configForms'];

    /** 模块级兜底引用：万一槽位渲染器没把 inject props 传下来，组件也能拿到表单。 */
    var currentForm = null;

    function apply(ctx) {
      currentForm = ctx.configForms.get(NS);
      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register({
          name: 'settings.section',
          id: 'prompt-inject',
          order: 60,
          label: function () { return '提示词注入'; },
          inject: function () { return { form: currentForm }; },
        }, PromptInjectSection);
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
