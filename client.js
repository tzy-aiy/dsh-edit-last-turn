/**
 * Edit Last Turn — client half.
 *
 * Adds a small "edit the previous message" entry to the composer dock. It
 * reads the last user message from the Host route, lets the user rewrite it,
 * and asks the Host to replace the conversation tail and let the model think
 * again from the edited text.
 */
window.__ModuleLoader__.load({
  id: 'dsh-edit-last-turn',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const BASE = '/dsh-edit-last-turn'

    const ZH = typeof navigator !== 'undefined' && /^zh/i.test(navigator.language || '')
    const STRINGS = {
      zh: {
        button: '编辑上一条',
        buttonRunning: '停止并编辑上一条',
        title: '编辑上一条消息',
        hint: '保存后会替换这条消息及其后的所有内容，并让模型重新思考。若模型正在回答，会先停止当前回答。',
        hintEmpty: '原来那条消息没有可编辑的文字，直接输入新内容即可。',
        placeholder: '修改你上一条消息…',
        save: '保存并重新思考',
        cancel: '取消',
        loading: '正在读取上一条消息…',
        notLive: '这个会话还没有加载到内存，先发一条消息再试。',
        noMessage: '这个会话里没有可编辑的用户消息。',
        empty: '内容不能为空。',
        saveFailed: '保存失败：',
        loadFailed: '读取失败：',
        dirty: '修改后将重新生成',
        pick: '选择要编辑的消息',
        pickLatest: '最新的一条',
        pickOlder: '第 %n 条（更早）',
      },
      en: {
        button: 'Edit last message',
        buttonRunning: 'Stop and edit last message',
        title: 'Edit the previous message',
        hint: 'Saving replaces this message and everything after it, then lets the model think again from the new text. A running answer is stopped first.',
        hintEmpty: 'That message had no editable text — just type the new wording.',
        placeholder: 'Rewrite your previous message…',
        save: 'Save and re-think',
        cancel: 'Cancel',
        loading: 'Loading the previous message…',
        notLive: 'This conversation is not loaded in memory yet — send a message once, then retry.',
        noMessage: 'This conversation has no user message to edit.',
        empty: 'The text cannot be empty.',
        saveFailed: 'Save failed: ',
        loadFailed: 'Load failed: ',
        dirty: 'Saving regenerates the answer',
        pick: 'Edit which message',
        pickLatest: 'latest',
        pickOlder: 'earlier #%n',
      },
    }
    const t = (key) => (ZH ? STRINGS.zh : STRINGS.en)[key]

    const clientTimeZone = (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      } catch {
        return 'UTC'
      }
    })()

    const styles = {
      row: { display: 'flex', alignItems: 'center', gap: 6, padding: '2px 10px 0', font: 'inherit' },
      button: {
        appearance: 'none',
        border: '1px solid rgba(128,128,128,0.35)',
        background: 'transparent',
        color: 'inherit',
        opacity: 0.72,
        borderRadius: 6,
        padding: '1px 8px',
        font: 'inherit',
        fontSize: 12,
        lineHeight: '18px',
        cursor: 'pointer',
      },
      panel: {
        margin: '4px 10px 0',
        border: '1px solid rgba(128,128,128,0.35)',
        borderRadius: 8,
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        background: 'rgba(128,128,128,0.06)',
      },
      title: { fontSize: 12, fontWeight: 600, opacity: 0.85 },
      hint: { fontSize: 11, opacity: 0.6, lineHeight: '16px' },
      area: {
        width: '100%',
        boxSizing: 'border-box',
        resize: 'vertical',
        minHeight: 68,
        maxHeight: 320,
        border: '1px solid rgba(128,128,128,0.35)',
        borderRadius: 6,
        padding: 6,
        font: 'inherit',
        fontSize: 13,
        lineHeight: '20px',
        color: 'inherit',
        background: 'rgba(127,127,127,0.10)',
        outline: 'none',
      },
      footer: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
      primary: {
        appearance: 'none',
        border: '1px solid rgba(80,140,255,0.55)',
        background: 'rgba(80,140,255,0.16)',
        color: 'inherit',
        borderRadius: 6,
        padding: '2px 12px',
        font: 'inherit',
        fontSize: 12,
        lineHeight: '20px',
        cursor: 'pointer',
      },
      ghost: {
        appearance: 'none',
        border: '1px solid rgba(128,128,128,0.35)',
        background: 'transparent',
        color: 'inherit',
        borderRadius: 6,
        padding: '2px 10px',
        font: 'inherit',
        fontSize: 12,
        lineHeight: '20px',
        cursor: 'pointer',
        opacity: 0.8,
      },
      error: { fontSize: 12, color: '#e2564d', lineHeight: '18px', whiteSpace: 'pre-wrap' },
    }

    async function requestJson(path, init) {
      const response = await fetch(BASE + path, init)
      let payload = null
      try {
        payload = await response.json()
      } catch {}
      if (payload === null || typeof payload !== 'object') {
        throw new Error(`HTTP ${response.status}`)
      }
      return payload
    }

    function EditLastTurn(props) {
      const sessionId = props?.sessionId
      const [open, setOpen] = React.useState(false)
      const [text, setText] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState('')
      const [error, setError] = React.useState('')
      const [original, setOriginal] = React.useState('')
      const [messages, setMessages] = React.useState([])
      const [seq, setSeq] = React.useState(null)
      const areaRef = React.useRef(null)

      const openEditor = React.useCallback(async () => {
        if (!sessionId) return
        setOpen(true)
        setError('')
        setNote(t('loading'))
        setBusy(true)
        try {
          const data = await requestJson(`/state?sessionId=${encodeURIComponent(sessionId)}&resume=1`, {
            headers: { accept: 'application/json' },
          })
          if (data.ok !== true) throw new Error(data.error || 'request failed')
          if (data.live !== true) {
            setNote(t('notLive'))
            return
          }
          if (data.editable !== true) {
            setNote(t('noMessage'))
            return
          }
          const value = typeof data.text === 'string' ? data.text : ''
          const list = Array.isArray(data.messages) ? data.messages.filter((entry) => typeof entry?.seq === 'number') : []
          setMessages(list)
          setSeq(typeof data.seq === 'number' ? data.seq : null)
          setText(value)
          setOriginal(value)
          setNote(value.trim() === '' ? t('hintEmpty') : t('hint'))
          setTimeout(() => areaRef.current?.focus?.(), 0)
        } catch (failure) {
          setNote('')
          setError(t('loadFailed') + (failure?.message ?? String(failure)))
        } finally {
          setBusy(false)
        }
      }, [sessionId])

      const pick = React.useCallback((nextSeq) => {
        const entry = messages.find((candidate) => candidate.seq === nextSeq)
        if (entry === undefined) return
        setSeq(nextSeq)
        setText(typeof entry.text === 'string' ? entry.text : '')
        setOriginal(typeof entry.text === 'string' ? entry.text : '')
        setError('')
      }, [messages])

      const closeEditor = React.useCallback(() => {
        if (busy) return
        setOpen(false)
        setText('')
        setOriginal('')
        setMessages([])
        setSeq(null)
        setNote('')
        setError('')
      }, [busy])

      const submit = React.useCallback(async () => {
        if (busy || !sessionId) return
        if (text.trim() === '') {
          setError(t('empty'))
          return
        }
        setBusy(true)
        setError('')
        try {
          const data = await requestJson('/apply', {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({
              sessionId,
              text,
              clientTimeZone,
              ...(typeof seq === 'number' ? { seq } : {}),
            }),
          })
          if (data.ok !== true) throw new Error(data.error || 'request failed')
          setOpen(false)
          setText('')
          setOriginal('')
          setMessages([])
          setSeq(null)
          setNote('')
        } catch (failure) {
          setError(t('saveFailed') + (failure?.message ?? String(failure)))
        } finally {
          setBusy(false)
        }
      }, [busy, sessionId, seq, text])

      if (!sessionId) return null

      if (!open) {
        return h(
          'div',
          { style: styles.row },
          h('button', {
            type: 'button',
            style: styles.button,
            title: t('title'),
            onClick: openEditor,
          }, t('button')),
        )
      }

      return h(
        'div',
        { style: styles.panel },
        h('div', { style: styles.title }, t('title')),
        messages.length > 1
          ? h(
            'div',
            { style: styles.footer },
            h('span', { style: styles.hint }, t('pick')),
            h(
              'select',
              {
                style: { ...styles.ghost, maxWidth: '70%' },
                value: typeof seq === 'number' ? String(seq) : '',
                disabled: busy,
                onChange: (event) => pick(Number(event.target.value)),
              },
              messages.map((entry, index) => {
                const position = index + 1 === messages.length
                  ? t('pickLatest')
                  : t('pickOlder').replace('%n', String(index + 1))
                const preview = typeof entry.preview === 'string' ? entry.preview.replace(/\s+/g, ' ').slice(0, 36) : ''
                return h('option', { key: entry.seq, value: String(entry.seq) }, `${position} · ${preview}`)
              }),
            ),
          )
          : null,
        h('textarea', {
          ref: areaRef,
          style: styles.area,
          value: text,
          spellCheck: false,
          placeholder: t('placeholder'),
          disabled: busy,
          onChange: (event) => setText(event.target.value),
          onKeyDown: (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              closeEditor()
            }
          },
        }),
        note === '' ? null : h('div', { style: styles.hint }, note),
        error === '' ? null : h('div', { style: styles.error }, error),
        h(
          'div',
          { style: styles.footer },
          h('button', {
            type: 'button',
            style: styles.primary,
            disabled: busy,
            onClick: submit,
          }, busy ? '…' : t('save')),
          h('button', {
            type: 'button',
            style: styles.ghost,
            disabled: busy,
            onClick: closeEditor,
          }, t('cancel')),
          text === original ? null : h('span', { style: styles.hint }, t('dirty')),
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'edit-last-turn',
          order: 20,
          label: () => t('button'),
        }, EditLastTurn))
      },
    }
  },
})
