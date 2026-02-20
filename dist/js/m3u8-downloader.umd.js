(function (w, S) {
  typeof exports == "object" && typeof module < "u"
    ? (module.exports = S())
    : typeof define == "function" && define.amd
      ? define(S)
      : ((w = typeof globalThis < "u" ? globalThis : w || self),
        (w.M3U8Downloader = S()));
})(this, function () {
  "use strict";
  var dn = Object.defineProperty;
  var er = (w) => {
    throw TypeError(w);
  };
  var hn = (w, S, D) =>
    S in w
      ? dn(w, S, { enumerable: !0, configurable: !0, writable: !0, value: D })
      : (w[S] = D);
  var Dt = (w, S, D) => hn(w, typeof S != "symbol" ? S + "" : S, D),
    te = (w, S, D) => S.has(w) || er("Cannot " + D);
  var b = (w, S, D) => (
      te(w, S, "read from private field"),
      D ? D.call(w) : S.get(w)
    ),
    x = (w, S, D) =>
      S.has(w)
        ? er("Cannot add the same private member more than once")
        : S instanceof WeakSet
          ? S.add(w)
          : S.set(w, D),
    C = (w, S, D, j) => (
      te(w, S, "write to private field"),
      j ? j.call(w, D) : S.set(w, D),
      D
    ),
    v = (w, S, D) => (te(w, S, "access private method"), D);
  var mt = (w, S, D, j) => ({
    set _(X) {
      C(w, S, X, D);
    },
    get _() {
      return b(w, S, j);
    },
  });
  var q,
    rt,
    st,
    K,
    ft,
    nt,
    dt,
    H,
    it,
    F,
    ht,
    $,
    at,
    V,
    pt,
    Nt,
    O,
    sr,
    nr,
    ir,
    ar,
    or,
    Pt,
    ee,
    re,
    Ct,
    ur,
    _t;
  function w(s, r) {
    return function () {
      return s.apply(r, arguments);
    };
  }
  const { toString: S } = Object.prototype,
    { getPrototypeOf: D } = Object,
    j = ((s) => (r) => {
      const e = S.call(r);
      return s[e] || (s[e] = e.slice(8, -1).toLowerCase());
    })(Object.create(null)),
    X = (s) => ((s = s.toLowerCase()), (r) => j(r) === s),
    Et = (s) => (r) => typeof r === s,
    { isArray: Z } = Array,
    ot = Et("undefined");
  function cr(s) {
    return (
      s !== null &&
      !ot(s) &&
      s.constructor !== null &&
      !ot(s.constructor) &&
      B(s.constructor.isBuffer) &&
      s.constructor.isBuffer(s)
    );
  }
  const se = X("ArrayBuffer");
  function lr(s) {
    let r;
    return (
      typeof ArrayBuffer < "u" && ArrayBuffer.isView
        ? (r = ArrayBuffer.isView(s))
        : (r = s && s.buffer && se(s.buffer)),
      r
    );
  }
  const fr = Et("string"),
    B = Et("function"),
    ne = Et("number"),
    gt = (s) => s !== null && typeof s == "object",
    dr = (s) => s === !0 || s === !1,
    Tt = (s) => {
      if (j(s) !== "object") return !1;
      const r = D(s);
      return (
        (r === null ||
          r === Object.prototype ||
          Object.getPrototypeOf(r) === null) &&
        !(Symbol.toStringTag in s) &&
        !(Symbol.iterator in s)
      );
    },
    hr = X("Date"),
    pr = X("File"),
    mr = X("Blob"),
    Er = X("FileList"),
    gr = (s) => gt(s) && B(s.pipe),
    Tr = (s) => {
      let r;
      return (
        s &&
        ((typeof FormData == "function" && s instanceof FormData) ||
          (B(s.append) &&
            ((r = j(s)) === "formdata" ||
              (r === "object" &&
                B(s.toString) &&
                s.toString() === "[object FormData]"))))
      );
    },
    br = X("URLSearchParams"),
    [Rr, yr, Ar, wr] = ["ReadableStream", "Request", "Response", "Headers"].map(
      X,
    ),
    Or = (s) =>
      s.trim ? s.trim() : s.replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, "");
  function ut(s, r, { allOwnKeys: e = !1 } = {}) {
    if (s === null || typeof s > "u") return;
    let t, n;
    if ((typeof s != "object" && (s = [s]), Z(s)))
      for (t = 0, n = s.length; t < n; t++) r.call(null, s[t], t, s);
    else {
      const i = e ? Object.getOwnPropertyNames(s) : Object.keys(s),
        a = i.length;
      let u;
      for (t = 0; t < a; t++) ((u = i[t]), r.call(null, s[u], u, s));
    }
  }
  function ie(s, r) {
    r = r.toLowerCase();
    const e = Object.keys(s);
    let t = e.length,
      n;
    for (; t-- > 0; ) if (((n = e[t]), r === n.toLowerCase())) return n;
    return null;
  }
  const W =
      typeof globalThis < "u"
        ? globalThis
        : typeof self < "u"
          ? self
          : typeof window < "u"
            ? window
            : global,
    ae = (s) => !ot(s) && s !== W;
  function xt() {
    const { caseless: s } = (ae(this) && this) || {},
      r = {},
      e = (t, n) => {
        const i = (s && ie(r, n)) || n;
        Tt(r[i]) && Tt(t)
          ? (r[i] = xt(r[i], t))
          : Tt(t)
            ? (r[i] = xt({}, t))
            : Z(t)
              ? (r[i] = t.slice())
              : (r[i] = t);
      };
    for (let t = 0, n = arguments.length; t < n; t++)
      arguments[t] && ut(arguments[t], e);
    return r;
  }
  const Sr = (s, r, e, { allOwnKeys: t } = {}) => (
      ut(
        r,
        (n, i) => {
          e && B(n) ? (s[i] = w(n, e)) : (s[i] = n);
        },
        { allOwnKeys: t },
      ),
      s
    ),
    Nr = (s) => (s.charCodeAt(0) === 65279 && (s = s.slice(1)), s),
    Ir = (s, r, e, t) => {
      ((s.prototype = Object.create(r.prototype, t)),
        (s.prototype.constructor = s),
        Object.defineProperty(s, "super", { value: r.prototype }),
        e && Object.assign(s.prototype, e));
    },
    Dr = (s, r, e, t) => {
      let n, i, a;
      const u = {};
      if (((r = r || {}), s == null)) return r;
      do {
        for (n = Object.getOwnPropertyNames(s), i = n.length; i-- > 0; )
          ((a = n[i]),
            (!t || t(a, s, r)) && !u[a] && ((r[a] = s[a]), (u[a] = !0)));
        s = e !== !1 && D(s);
      } while (s && (!e || e(s, r)) && s !== Object.prototype);
      return r;
    },
    Pr = (s, r, e) => {
      ((s = String(s)),
        (e === void 0 || e > s.length) && (e = s.length),
        (e -= r.length));
      const t = s.indexOf(r, e);
      return t !== -1 && t === e;
    },
    Cr = (s) => {
      if (!s) return null;
      if (Z(s)) return s;
      let r = s.length;
      if (!ne(r)) return null;
      const e = new Array(r);
      for (; r-- > 0; ) e[r] = s[r];
      return e;
    },
    _r = (
      (s) => (r) =>
        s && r instanceof s
    )(typeof Uint8Array < "u" && D(Uint8Array)),
    xr = (s, r) => {
      const t = (s && s[Symbol.iterator]).call(s);
      let n;
      for (; (n = t.next()) && !n.done; ) {
        const i = n.value;
        r.call(s, i[0], i[1]);
      }
    },
    vr = (s, r) => {
      let e;
      const t = [];
      for (; (e = s.exec(r)) !== null; ) t.push(e);
      return t;
    },
    Ur = X("HTMLFormElement"),
    Lr = (s) =>
      s.toLowerCase().replace(/[-_\s]([a-z\d])(\w*)/g, function (e, t, n) {
        return t.toUpperCase() + n;
      }),
    oe = (
      ({ hasOwnProperty: s }) =>
      (r, e) =>
        s.call(r, e)
    )(Object.prototype),
    Fr = X("RegExp"),
    ue = (s, r) => {
      const e = Object.getOwnPropertyDescriptors(s),
        t = {};
      (ut(e, (n, i) => {
        let a;
        (a = r(n, i, s)) !== !1 && (t[i] = a || n);
      }),
        Object.defineProperties(s, t));
    },
    Mr = (s) => {
      ue(s, (r, e) => {
        if (B(s) && ["arguments", "caller", "callee"].indexOf(e) !== -1)
          return !1;
        const t = s[e];
        if (B(t)) {
          if (((r.enumerable = !1), "writable" in r)) {
            r.writable = !1;
            return;
          }
          r.set ||
            (r.set = () => {
              throw Error("Can not rewrite read-only method '" + e + "'");
            });
        }
      });
    },
    Xr = (s, r) => {
      const e = {},
        t = (n) => {
          n.forEach((i) => {
            e[i] = !0;
          });
        };
      return (Z(s) ? t(s) : t(String(s).split(r)), e);
    },
    Br = () => {},
    qr = (s, r) => (s != null && Number.isFinite((s = +s)) ? s : r),
    vt = "abcdefghijklmnopqrstuvwxyz",
    ce = "0123456789",
    le = { DIGIT: ce, ALPHA: vt, ALPHA_DIGIT: vt + vt.toUpperCase() + ce },
    Hr = (s = 16, r = le.ALPHA_DIGIT) => {
      let e = "";
      const { length: t } = r;
      for (; s--; ) e += r[(Math.random() * t) | 0];
      return e;
    };
  function $r(s) {
    return !!(
      s &&
      B(s.append) &&
      s[Symbol.toStringTag] === "FormData" &&
      s[Symbol.iterator]
    );
  }
  const kr = (s) => {
      const r = new Array(10),
        e = (t, n) => {
          if (gt(t)) {
            if (r.indexOf(t) >= 0) return;
            if (!("toJSON" in t)) {
              r[n] = t;
              const i = Z(t) ? [] : {};
              return (
                ut(t, (a, u) => {
                  const m = e(a, n + 1);
                  !ot(m) && (i[u] = m);
                }),
                (r[n] = void 0),
                i
              );
            }
          }
          return t;
        };
      return e(s, 0);
    },
    Gr = X("AsyncFunction"),
    jr = (s) => s && (gt(s) || B(s)) && B(s.then) && B(s.catch),
    fe = ((s, r) =>
      s
        ? setImmediate
        : r
          ? ((e, t) => (
              W.addEventListener(
                "message",
                ({ source: n, data: i }) => {
                  n === W && i === e && t.length && t.shift()();
                },
                !1,
              ),
              (n) => {
                (t.push(n), W.postMessage(e, "*"));
              }
            ))(`axios@${Math.random()}`, [])
          : (e) => setTimeout(e))(
      typeof setImmediate == "function",
      B(W.postMessage),
    ),
    Vr =
      typeof queueMicrotask < "u"
        ? queueMicrotask.bind(W)
        : (typeof process < "u" && process.nextTick) || fe,
    l = {
      isArray: Z,
      isArrayBuffer: se,
      isBuffer: cr,
      isFormData: Tr,
      isArrayBufferView: lr,
      isString: fr,
      isNumber: ne,
      isBoolean: dr,
      isObject: gt,
      isPlainObject: Tt,
      isReadableStream: Rr,
      isRequest: yr,
      isResponse: Ar,
      isHeaders: wr,
      isUndefined: ot,
      isDate: hr,
      isFile: pr,
      isBlob: mr,
      isRegExp: Fr,
      isFunction: B,
      isStream: gr,
      isURLSearchParams: br,
      isTypedArray: _r,
      isFileList: Er,
      forEach: ut,
      merge: xt,
      extend: Sr,
      trim: Or,
      stripBOM: Nr,
      inherits: Ir,
      toFlatObject: Dr,
      kindOf: j,
      kindOfTest: X,
      endsWith: Pr,
      toArray: Cr,
      forEachEntry: xr,
      matchAll: vr,
      isHTMLForm: Ur,
      hasOwnProperty: oe,
      hasOwnProp: oe,
      reduceDescriptors: ue,
      freezeMethods: Mr,
      toObjectSet: Xr,
      toCamelCase: Lr,
      noop: Br,
      toFiniteNumber: qr,
      findKey: ie,
      global: W,
      isContextDefined: ae,
      ALPHABET: le,
      generateString: Hr,
      isSpecCompliantForm: $r,
      toJSONObject: kr,
      isAsyncFn: Gr,
      isThenable: jr,
      setImmediate: fe,
      asap: Vr,
    };
  function A(s, r, e, t, n) {
    (Error.call(this),
      Error.captureStackTrace
        ? Error.captureStackTrace(this, this.constructor)
        : (this.stack = new Error().stack),
      (this.message = s),
      (this.name = "AxiosError"),
      r && (this.code = r),
      e && (this.config = e),
      t && (this.request = t),
      n && ((this.response = n), (this.status = n.status ? n.status : null)));
  }
  l.inherits(A, Error, {
    toJSON: function () {
      return {
        message: this.message,
        name: this.name,
        description: this.description,
        number: this.number,
        fileName: this.fileName,
        lineNumber: this.lineNumber,
        columnNumber: this.columnNumber,
        stack: this.stack,
        config: l.toJSONObject(this.config),
        code: this.code,
        status: this.status,
      };
    },
  });
  const de = A.prototype,
    he = {};
  ([
    "ERR_BAD_OPTION_VALUE",
    "ERR_BAD_OPTION",
    "ECONNABORTED",
    "ETIMEDOUT",
    "ERR_NETWORK",
    "ERR_FR_TOO_MANY_REDIRECTS",
    "ERR_DEPRECATED",
    "ERR_BAD_RESPONSE",
    "ERR_BAD_REQUEST",
    "ERR_CANCELED",
    "ERR_NOT_SUPPORT",
    "ERR_INVALID_URL",
  ].forEach((s) => {
    he[s] = { value: s };
  }),
    Object.defineProperties(A, he),
    Object.defineProperty(de, "isAxiosError", { value: !0 }),
    (A.from = (s, r, e, t, n, i) => {
      const a = Object.create(de);
      return (
        l.toFlatObject(
          s,
          a,
          function (m) {
            return m !== Error.prototype;
          },
          (u) => u !== "isAxiosError",
        ),
        A.call(a, s.message, r, e, t, n),
        (a.cause = s),
        (a.name = s.name),
        i && Object.assign(a, i),
        a
      );
    }));
  const zr = null;
  function Ut(s) {
    return l.isPlainObject(s) || l.isArray(s);
  }
  function pe(s) {
    return l.endsWith(s, "[]") ? s.slice(0, -2) : s;
  }
  function me(s, r, e) {
    return s
      ? s
          .concat(r)
          .map(function (n, i) {
            return ((n = pe(n)), !e && i ? "[" + n + "]" : n);
          })
          .join(e ? "." : "")
      : r;
  }
  function Yr(s) {
    return l.isArray(s) && !s.some(Ut);
  }
  const Kr = l.toFlatObject(l, {}, null, function (r) {
    return /^is[A-Z]/.test(r);
  });
  function bt(s, r, e) {
    if (!l.isObject(s)) throw new TypeError("target must be an object");
    ((r = r || new FormData()),
      (e = l.toFlatObject(
        e,
        { metaTokens: !0, dots: !1, indexes: !1 },
        !1,
        function (o, d) {
          return !l.isUndefined(d[o]);
        },
      )));
    const t = e.metaTokens,
      n = e.visitor || f,
      i = e.dots,
      a = e.indexes,
      m = (e.Blob || (typeof Blob < "u" && Blob)) && l.isSpecCompliantForm(r);
    if (!l.isFunction(n)) throw new TypeError("visitor must be a function");
    function c(E) {
      if (E === null) return "";
      if (l.isDate(E)) return E.toISOString();
      if (!m && l.isBlob(E))
        throw new A("Blob is not supported. Use a Buffer instead.");
      return l.isArrayBuffer(E) || l.isTypedArray(E)
        ? m && typeof Blob == "function"
          ? new Blob([E])
          : Buffer.from(E)
        : E;
    }
    function f(E, o, d) {
      let y = E;
      if (E && !d && typeof E == "object") {
        if (l.endsWith(o, "{}"))
          ((o = t ? o : o.slice(0, -2)), (E = JSON.stringify(E)));
        else if (
          (l.isArray(E) && Yr(E)) ||
          ((l.isFileList(E) || l.endsWith(o, "[]")) && (y = l.toArray(E)))
        )
          return (
            (o = pe(o)),
            y.forEach(function (p, I) {
              !(l.isUndefined(p) || p === null) &&
                r.append(
                  a === !0 ? me([o], I, i) : a === null ? o : o + "[]",
                  c(p),
                );
            }),
            !1
          );
      }
      return Ut(E) ? !0 : (r.append(me(d, o, i), c(E)), !1);
    }
    const h = [],
      R = Object.assign(Kr, {
        defaultVisitor: f,
        convertValue: c,
        isVisitable: Ut,
      });
    function T(E, o) {
      if (!l.isUndefined(E)) {
        if (h.indexOf(E) !== -1)
          throw Error("Circular reference detected in " + o.join("."));
        (h.push(E),
          l.forEach(E, function (y, g) {
            (!(l.isUndefined(y) || y === null) &&
              n.call(r, y, l.isString(g) ? g.trim() : g, o, R)) === !0 &&
              T(y, o ? o.concat(g) : [g]);
          }),
          h.pop());
      }
    }
    if (!l.isObject(s)) throw new TypeError("data must be an object");
    return (T(s), r);
  }
  function Ee(s) {
    const r = {
      "!": "%21",
      "'": "%27",
      "(": "%28",
      ")": "%29",
      "~": "%7E",
      "%20": "+",
      "%00": "\0",
    };
    return encodeURIComponent(s).replace(/[!'()~]|%20|%00/g, function (t) {
      return r[t];
    });
  }
  function Lt(s, r) {
    ((this._pairs = []), s && bt(s, this, r));
  }
  const ge = Lt.prototype;
  ((ge.append = function (r, e) {
    this._pairs.push([r, e]);
  }),
    (ge.toString = function (r) {
      const e = r
        ? function (t) {
            return r.call(this, t, Ee);
          }
        : Ee;
      return this._pairs
        .map(function (n) {
          return e(n[0]) + "=" + e(n[1]);
        }, "")
        .join("&");
    }));
  function Wr(s) {
    return encodeURIComponent(s)
      .replace(/%3A/gi, ":")
      .replace(/%24/g, "$")
      .replace(/%2C/gi, ",")
      .replace(/%20/g, "+")
      .replace(/%5B/gi, "[")
      .replace(/%5D/gi, "]");
  }
  function Te(s, r, e) {
    if (!r) return s;
    const t = (e && e.encode) || Wr;
    l.isFunction(e) && (e = { serialize: e });
    const n = e && e.serialize;
    let i;
    if (
      (n
        ? (i = n(r, e))
        : (i = l.isURLSearchParams(r)
            ? r.toString()
            : new Lt(r, e).toString(t)),
      i)
    ) {
      const a = s.indexOf("#");
      (a !== -1 && (s = s.slice(0, a)),
        (s += (s.indexOf("?") === -1 ? "?" : "&") + i));
    }
    return s;
  }
  class be {
    constructor() {
      this.handlers = [];
    }
    use(r, e, t) {
      return (
        this.handlers.push({
          fulfilled: r,
          rejected: e,
          synchronous: t ? t.synchronous : !1,
          runWhen: t ? t.runWhen : null,
        }),
        this.handlers.length - 1
      );
    }
    eject(r) {
      this.handlers[r] && (this.handlers[r] = null);
    }
    clear() {
      this.handlers && (this.handlers = []);
    }
    forEach(r) {
      l.forEach(this.handlers, function (t) {
        t !== null && r(t);
      });
    }
  }
  const Re = {
      silentJSONParsing: !0,
      forcedJSONParsing: !0,
      clarifyTimeoutError: !1,
    },
    Jr = {
      isBrowser: !0,
      classes: {
        URLSearchParams: typeof URLSearchParams < "u" ? URLSearchParams : Lt,
        FormData: typeof FormData < "u" ? FormData : null,
        Blob: typeof Blob < "u" ? Blob : null,
      },
      protocols: ["http", "https", "file", "blob", "url", "data"],
    },
    Ft = typeof window < "u" && typeof document < "u",
    Mt = (typeof navigator == "object" && navigator) || void 0,
    Qr =
      Ft &&
      (!Mt || ["ReactNative", "NativeScript", "NS"].indexOf(Mt.product) < 0),
    Zr =
      typeof WorkerGlobalScope < "u" &&
      self instanceof WorkerGlobalScope &&
      typeof self.importScripts == "function",
    ts = (Ft && window.location.href) || "http://localhost",
    U = {
      ...Object.freeze(
        Object.defineProperty(
          {
            __proto__: null,
            hasBrowserEnv: Ft,
            hasStandardBrowserEnv: Qr,
            hasStandardBrowserWebWorkerEnv: Zr,
            navigator: Mt,
            origin: ts,
          },
          Symbol.toStringTag,
          { value: "Module" },
        ),
      ),
      ...Jr,
    };
  function es(s, r) {
    return bt(
      s,
      new U.classes.URLSearchParams(),
      Object.assign(
        {
          visitor: function (e, t, n, i) {
            return U.isNode && l.isBuffer(e)
              ? (this.append(t, e.toString("base64")), !1)
              : i.defaultVisitor.apply(this, arguments);
          },
        },
        r,
      ),
    );
  }
  function rs(s) {
    return l
      .matchAll(/\w+|\[(\w*)]/g, s)
      .map((r) => (r[0] === "[]" ? "" : r[1] || r[0]));
  }
  function ss(s) {
    const r = {},
      e = Object.keys(s);
    let t;
    const n = e.length;
    let i;
    for (t = 0; t < n; t++) ((i = e[t]), (r[i] = s[i]));
    return r;
  }
  function ye(s) {
    function r(e, t, n, i) {
      let a = e[i++];
      if (a === "__proto__") return !0;
      const u = Number.isFinite(+a),
        m = i >= e.length;
      return (
        (a = !a && l.isArray(n) ? n.length : a),
        m
          ? (l.hasOwnProp(n, a) ? (n[a] = [n[a], t]) : (n[a] = t), !u)
          : ((!n[a] || !l.isObject(n[a])) && (n[a] = []),
            r(e, t, n[a], i) && l.isArray(n[a]) && (n[a] = ss(n[a])),
            !u)
      );
    }
    if (l.isFormData(s) && l.isFunction(s.entries)) {
      const e = {};
      return (
        l.forEachEntry(s, (t, n) => {
          r(rs(t), n, e, 0);
        }),
        e
      );
    }
    return null;
  }
  function ns(s, r, e) {
    if (l.isString(s))
      try {
        return ((r || JSON.parse)(s), l.trim(s));
      } catch (t) {
        if (t.name !== "SyntaxError") throw t;
      }
    return (e || JSON.stringify)(s);
  }
  const ct = {
    transitional: Re,
    adapter: ["xhr", "http", "fetch"],
    transformRequest: [
      function (r, e) {
        const t = e.getContentType() || "",
          n = t.indexOf("application/json") > -1,
          i = l.isObject(r);
        if ((i && l.isHTMLForm(r) && (r = new FormData(r)), l.isFormData(r)))
          return n ? JSON.stringify(ye(r)) : r;
        if (
          l.isArrayBuffer(r) ||
          l.isBuffer(r) ||
          l.isStream(r) ||
          l.isFile(r) ||
          l.isBlob(r) ||
          l.isReadableStream(r)
        )
          return r;
        if (l.isArrayBufferView(r)) return r.buffer;
        if (l.isURLSearchParams(r))
          return (
            e.setContentType(
              "application/x-www-form-urlencoded;charset=utf-8",
              !1,
            ),
            r.toString()
          );
        let u;
        if (i) {
          if (t.indexOf("application/x-www-form-urlencoded") > -1)
            return es(r, this.formSerializer).toString();
          if ((u = l.isFileList(r)) || t.indexOf("multipart/form-data") > -1) {
            const m = this.env && this.env.FormData;
            return bt(
              u ? { "files[]": r } : r,
              m && new m(),
              this.formSerializer,
            );
          }
        }
        return i || n ? (e.setContentType("application/json", !1), ns(r)) : r;
      },
    ],
    transformResponse: [
      function (r) {
        const e = this.transitional || ct.transitional,
          t = e && e.forcedJSONParsing,
          n = this.responseType === "json";
        if (l.isResponse(r) || l.isReadableStream(r)) return r;
        if (r && l.isString(r) && ((t && !this.responseType) || n)) {
          const a = !(e && e.silentJSONParsing) && n;
          try {
            return JSON.parse(r);
          } catch (u) {
            if (a)
              throw u.name === "SyntaxError"
                ? A.from(u, A.ERR_BAD_RESPONSE, this, null, this.response)
                : u;
          }
        }
        return r;
      },
    ],
    timeout: 0,
    xsrfCookieName: "XSRF-TOKEN",
    xsrfHeaderName: "X-XSRF-TOKEN",
    maxContentLength: -1,
    maxBodyLength: -1,
    env: { FormData: U.classes.FormData, Blob: U.classes.Blob },
    validateStatus: function (r) {
      return r >= 200 && r < 300;
    },
    headers: {
      common: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": void 0,
      },
    },
  };
  l.forEach(["delete", "get", "head", "post", "put", "patch"], (s) => {
    ct.headers[s] = {};
  });
  const is = l.toObjectSet([
      "age",
      "authorization",
      "content-length",
      "content-type",
      "etag",
      "expires",
      "from",
      "host",
      "if-modified-since",
      "if-unmodified-since",
      "last-modified",
      "location",
      "max-forwards",
      "proxy-authorization",
      "referer",
      "retry-after",
      "user-agent",
    ]),
    as = (s) => {
      const r = {};
      let e, t, n;
      return (
        s &&
          s
            .split(
              `
`,
            )
            .forEach(function (a) {
              ((n = a.indexOf(":")),
                (e = a.substring(0, n).trim().toLowerCase()),
                (t = a.substring(n + 1).trim()),
                !(!e || (r[e] && is[e])) &&
                  (e === "set-cookie"
                    ? r[e]
                      ? r[e].push(t)
                      : (r[e] = [t])
                    : (r[e] = r[e] ? r[e] + ", " + t : t)));
            }),
        r
      );
    },
    Ae = Symbol("internals");
  function lt(s) {
    return s && String(s).trim().toLowerCase();
  }
  function Rt(s) {
    return s === !1 || s == null ? s : l.isArray(s) ? s.map(Rt) : String(s);
  }
  function os(s) {
    const r = Object.create(null),
      e = /([^\s,;=]+)\s*(?:=\s*([^,;]+))?/g;
    let t;
    for (; (t = e.exec(s)); ) r[t[1]] = t[2];
    return r;
  }
  const us = (s) => /^[-_a-zA-Z0-9^`|~,!#$%&'*+.]+$/.test(s.trim());
  function Xt(s, r, e, t, n) {
    if (l.isFunction(t)) return t.call(this, r, e);
    if ((n && (r = e), !!l.isString(r))) {
      if (l.isString(t)) return r.indexOf(t) !== -1;
      if (l.isRegExp(t)) return t.test(r);
    }
  }
  function cs(s) {
    return s
      .trim()
      .toLowerCase()
      .replace(/([a-z\d])(\w*)/g, (r, e, t) => e.toUpperCase() + t);
  }
  function ls(s, r) {
    const e = l.toCamelCase(" " + r);
    ["get", "set", "has"].forEach((t) => {
      Object.defineProperty(s, t + e, {
        value: function (n, i, a) {
          return this[t].call(this, r, n, i, a);
        },
        configurable: !0,
      });
    });
  }
  let M = class {
    constructor(r) {
      r && this.set(r);
    }
    set(r, e, t) {
      const n = this;
      function i(u, m, c) {
        const f = lt(m);
        if (!f) throw new Error("header name must be a non-empty string");
        const h = l.findKey(n, f);
        (!h || n[h] === void 0 || c === !0 || (c === void 0 && n[h] !== !1)) &&
          (n[h || m] = Rt(u));
      }
      const a = (u, m) => l.forEach(u, (c, f) => i(c, f, m));
      if (l.isPlainObject(r) || r instanceof this.constructor) a(r, e);
      else if (l.isString(r) && (r = r.trim()) && !us(r)) a(as(r), e);
      else if (l.isHeaders(r)) for (const [u, m] of r.entries()) i(m, u, t);
      else r != null && i(e, r, t);
      return this;
    }
    get(r, e) {
      if (((r = lt(r)), r)) {
        const t = l.findKey(this, r);
        if (t) {
          const n = this[t];
          if (!e) return n;
          if (e === !0) return os(n);
          if (l.isFunction(e)) return e.call(this, n, t);
          if (l.isRegExp(e)) return e.exec(n);
          throw new TypeError("parser must be boolean|regexp|function");
        }
      }
    }
    has(r, e) {
      if (((r = lt(r)), r)) {
        const t = l.findKey(this, r);
        return !!(t && this[t] !== void 0 && (!e || Xt(this, this[t], t, e)));
      }
      return !1;
    }
    delete(r, e) {
      const t = this;
      let n = !1;
      function i(a) {
        if (((a = lt(a)), a)) {
          const u = l.findKey(t, a);
          u && (!e || Xt(t, t[u], u, e)) && (delete t[u], (n = !0));
        }
      }
      return (l.isArray(r) ? r.forEach(i) : i(r), n);
    }
    clear(r) {
      const e = Object.keys(this);
      let t = e.length,
        n = !1;
      for (; t--; ) {
        const i = e[t];
        (!r || Xt(this, this[i], i, r, !0)) && (delete this[i], (n = !0));
      }
      return n;
    }
    normalize(r) {
      const e = this,
        t = {};
      return (
        l.forEach(this, (n, i) => {
          const a = l.findKey(t, i);
          if (a) {
            ((e[a] = Rt(n)), delete e[i]);
            return;
          }
          const u = r ? cs(i) : String(i).trim();
          (u !== i && delete e[i], (e[u] = Rt(n)), (t[u] = !0));
        }),
        this
      );
    }
    concat(...r) {
      return this.constructor.concat(this, ...r);
    }
    toJSON(r) {
      const e = Object.create(null);
      return (
        l.forEach(this, (t, n) => {
          t != null &&
            t !== !1 &&
            (e[n] = r && l.isArray(t) ? t.join(", ") : t);
        }),
        e
      );
    }
    [Symbol.iterator]() {
      return Object.entries(this.toJSON())[Symbol.iterator]();
    }
    toString() {
      return Object.entries(this.toJSON()).map(([r, e]) => r + ": " + e).join(`
`);
    }
    get [Symbol.toStringTag]() {
      return "AxiosHeaders";
    }
    static from(r) {
      return r instanceof this ? r : new this(r);
    }
    static concat(r, ...e) {
      const t = new this(r);
      return (e.forEach((n) => t.set(n)), t);
    }
    static accessor(r) {
      const t = (this[Ae] = this[Ae] = { accessors: {} }).accessors,
        n = this.prototype;
      function i(a) {
        const u = lt(a);
        t[u] || (ls(n, a), (t[u] = !0));
      }
      return (l.isArray(r) ? r.forEach(i) : i(r), this);
    }
  };
  (M.accessor([
    "Content-Type",
    "Content-Length",
    "Accept",
    "Accept-Encoding",
    "User-Agent",
    "Authorization",
  ]),
    l.reduceDescriptors(M.prototype, ({ value: s }, r) => {
      let e = r[0].toUpperCase() + r.slice(1);
      return {
        get: () => s,
        set(t) {
          this[e] = t;
        },
      };
    }),
    l.freezeMethods(M));
  function Bt(s, r) {
    const e = this || ct,
      t = r || e,
      n = M.from(t.headers);
    let i = t.data;
    return (
      l.forEach(s, function (u) {
        i = u.call(e, i, n.normalize(), r ? r.status : void 0);
      }),
      n.normalize(),
      i
    );
  }
  function we(s) {
    return !!(s && s.__CANCEL__);
  }
  function tt(s, r, e) {
    (A.call(this, s ?? "canceled", A.ERR_CANCELED, r, e),
      (this.name = "CanceledError"));
  }
  l.inherits(tt, A, { __CANCEL__: !0 });
  function Oe(s, r, e) {
    const t = e.config.validateStatus;
    !e.status || !t || t(e.status)
      ? s(e)
      : r(
          new A(
            "Request failed with status code " + e.status,
            [A.ERR_BAD_REQUEST, A.ERR_BAD_RESPONSE][
              Math.floor(e.status / 100) - 4
            ],
            e.config,
            e.request,
            e,
          ),
        );
  }
  function fs(s) {
    const r = /^([-+\w]{1,25})(:?\/\/|:)/.exec(s);
    return (r && r[1]) || "";
  }
  function ds(s, r) {
    s = s || 10;
    const e = new Array(s),
      t = new Array(s);
    let n = 0,
      i = 0,
      a;
    return (
      (r = r !== void 0 ? r : 1e3),
      function (m) {
        const c = Date.now(),
          f = t[i];
        (a || (a = c), (e[n] = m), (t[n] = c));
        let h = i,
          R = 0;
        for (; h !== n; ) ((R += e[h++]), (h = h % s));
        if (((n = (n + 1) % s), n === i && (i = (i + 1) % s), c - a < r))
          return;
        const T = f && c - f;
        return T ? Math.round((R * 1e3) / T) : void 0;
      }
    );
  }
  function hs(s, r) {
    let e = 0,
      t = 1e3 / r,
      n,
      i;
    const a = (c, f = Date.now()) => {
      ((e = f),
        (n = null),
        i && (clearTimeout(i), (i = null)),
        s.apply(null, c));
    };
    return [
      (...c) => {
        const f = Date.now(),
          h = f - e;
        h >= t
          ? a(c, f)
          : ((n = c),
            i ||
              (i = setTimeout(() => {
                ((i = null), a(n));
              }, t - h)));
      },
      () => n && a(n),
    ];
  }
  const yt = (s, r, e = 3) => {
      let t = 0;
      const n = ds(50, 250);
      return hs((i) => {
        const a = i.loaded,
          u = i.lengthComputable ? i.total : void 0,
          m = a - t,
          c = n(m),
          f = a <= u;
        t = a;
        const h = {
          loaded: a,
          total: u,
          progress: u ? a / u : void 0,
          bytes: m,
          rate: c || void 0,
          estimated: c && u && f ? (u - a) / c : void 0,
          event: i,
          lengthComputable: u != null,
          [r ? "download" : "upload"]: !0,
        };
        s(h);
      }, e);
    },
    Se = (s, r) => {
      const e = s != null;
      return [(t) => r[0]({ lengthComputable: e, total: s, loaded: t }), r[1]];
    },
    Ne =
      (s) =>
      (...r) =>
        l.asap(() => s(...r)),
    ps = U.hasStandardBrowserEnv
      ? ((s, r) => (e) => (
          (e = new URL(e, U.origin)),
          s.protocol === e.protocol &&
            s.host === e.host &&
            (r || s.port === e.port)
        ))(
          new URL(U.origin),
          U.navigator && /(msie|trident)/i.test(U.navigator.userAgent),
        )
      : () => !0,
    ms = U.hasStandardBrowserEnv
      ? {
          write(s, r, e, t, n, i) {
            const a = [s + "=" + encodeURIComponent(r)];
            (l.isNumber(e) && a.push("expires=" + new Date(e).toGMTString()),
              l.isString(t) && a.push("path=" + t),
              l.isString(n) && a.push("domain=" + n),
              i === !0 && a.push("secure"),
              (document.cookie = a.join("; ")));
          },
          read(s) {
            const r = document.cookie.match(
              new RegExp("(^|;\\s*)(" + s + ")=([^;]*)"),
            );
            return r ? decodeURIComponent(r[3]) : null;
          },
          remove(s) {
            this.write(s, "", Date.now() - 864e5);
          },
        }
      : {
          write() {},
          read() {
            return null;
          },
          remove() {},
        };
  function Es(s) {
    return /^([a-z][a-z\d+\-.]*:)?\/\//i.test(s);
  }
  function gs(s, r) {
    return r ? s.replace(/\/?\/$/, "") + "/" + r.replace(/^\/+/, "") : s;
  }
  function Ie(s, r) {
    return s && !Es(r) ? gs(s, r) : r;
  }
  const De = (s) => (s instanceof M ? { ...s } : s);
  function J(s, r) {
    r = r || {};
    const e = {};
    function t(c, f, h, R) {
      return l.isPlainObject(c) && l.isPlainObject(f)
        ? l.merge.call({ caseless: R }, c, f)
        : l.isPlainObject(f)
          ? l.merge({}, f)
          : l.isArray(f)
            ? f.slice()
            : f;
    }
    function n(c, f, h, R) {
      if (l.isUndefined(f)) {
        if (!l.isUndefined(c)) return t(void 0, c, h, R);
      } else return t(c, f, h, R);
    }
    function i(c, f) {
      if (!l.isUndefined(f)) return t(void 0, f);
    }
    function a(c, f) {
      if (l.isUndefined(f)) {
        if (!l.isUndefined(c)) return t(void 0, c);
      } else return t(void 0, f);
    }
    function u(c, f, h) {
      if (h in r) return t(c, f);
      if (h in s) return t(void 0, c);
    }
    const m = {
      url: i,
      method: i,
      data: i,
      baseURL: a,
      transformRequest: a,
      transformResponse: a,
      paramsSerializer: a,
      timeout: a,
      timeoutMessage: a,
      withCredentials: a,
      withXSRFToken: a,
      adapter: a,
      responseType: a,
      xsrfCookieName: a,
      xsrfHeaderName: a,
      onUploadProgress: a,
      onDownloadProgress: a,
      decompress: a,
      maxContentLength: a,
      maxBodyLength: a,
      beforeRedirect: a,
      transport: a,
      httpAgent: a,
      httpsAgent: a,
      cancelToken: a,
      socketPath: a,
      responseEncoding: a,
      validateStatus: u,
      headers: (c, f, h) => n(De(c), De(f), h, !0),
    };
    return (
      l.forEach(Object.keys(Object.assign({}, s, r)), function (f) {
        const h = m[f] || n,
          R = h(s[f], r[f], f);
        (l.isUndefined(R) && h !== u) || (e[f] = R);
      }),
      e
    );
  }
  const Pe = (s) => {
      const r = J({}, s);
      let {
        data: e,
        withXSRFToken: t,
        xsrfHeaderName: n,
        xsrfCookieName: i,
        headers: a,
        auth: u,
      } = r;
      ((r.headers = a = M.from(a)),
        (r.url = Te(Ie(r.baseURL, r.url), s.params, s.paramsSerializer)),
        u &&
          a.set(
            "Authorization",
            "Basic " +
              btoa(
                (u.username || "") +
                  ":" +
                  (u.password ? unescape(encodeURIComponent(u.password)) : ""),
              ),
          ));
      let m;
      if (l.isFormData(e)) {
        if (U.hasStandardBrowserEnv || U.hasStandardBrowserWebWorkerEnv)
          a.setContentType(void 0);
        else if ((m = a.getContentType()) !== !1) {
          const [c, ...f] = m
            ? m
                .split(";")
                .map((h) => h.trim())
                .filter(Boolean)
            : [];
          a.setContentType([c || "multipart/form-data", ...f].join("; "));
        }
      }
      if (
        U.hasStandardBrowserEnv &&
        (t && l.isFunction(t) && (t = t(r)), t || (t !== !1 && ps(r.url)))
      ) {
        const c = n && i && ms.read(i);
        c && a.set(n, c);
      }
      return r;
    },
    Ts =
      typeof XMLHttpRequest < "u" &&
      function (s) {
        return new Promise(function (e, t) {
          const n = Pe(s);
          let i = n.data;
          const a = M.from(n.headers).normalize();
          let {
              responseType: u,
              onUploadProgress: m,
              onDownloadProgress: c,
            } = n,
            f,
            h,
            R,
            T,
            E;
          function o() {
            (T && T(),
              E && E(),
              n.cancelToken && n.cancelToken.unsubscribe(f),
              n.signal && n.signal.removeEventListener("abort", f));
          }
          let d = new XMLHttpRequest();
          (d.open(n.method.toUpperCase(), n.url, !0), (d.timeout = n.timeout));
          function y() {
            if (!d) return;
            const p = M.from(
                "getAllResponseHeaders" in d && d.getAllResponseHeaders(),
              ),
              N = {
                data:
                  !u || u === "text" || u === "json"
                    ? d.responseText
                    : d.response,
                status: d.status,
                statusText: d.statusText,
                headers: p,
                config: s,
                request: d,
              };
            (Oe(
              function (G) {
                (e(G), o());
              },
              function (G) {
                (t(G), o());
              },
              N,
            ),
              (d = null));
          }
          ("onloadend" in d
            ? (d.onloadend = y)
            : (d.onreadystatechange = function () {
                !d ||
                  d.readyState !== 4 ||
                  (d.status === 0 &&
                    !(d.responseURL && d.responseURL.indexOf("file:") === 0)) ||
                  setTimeout(y);
              }),
            (d.onabort = function () {
              d &&
                (t(new A("Request aborted", A.ECONNABORTED, s, d)), (d = null));
            }),
            (d.onerror = function () {
              (t(new A("Network Error", A.ERR_NETWORK, s, d)), (d = null));
            }),
            (d.ontimeout = function () {
              let I = n.timeout
                ? "timeout of " + n.timeout + "ms exceeded"
                : "timeout exceeded";
              const N = n.transitional || Re;
              (n.timeoutErrorMessage && (I = n.timeoutErrorMessage),
                t(
                  new A(
                    I,
                    N.clarifyTimeoutError ? A.ETIMEDOUT : A.ECONNABORTED,
                    s,
                    d,
                  ),
                ),
                (d = null));
            }),
            i === void 0 && a.setContentType(null),
            "setRequestHeader" in d &&
              l.forEach(a.toJSON(), function (I, N) {
                d.setRequestHeader(N, I);
              }),
            l.isUndefined(n.withCredentials) ||
              (d.withCredentials = !!n.withCredentials),
            u && u !== "json" && (d.responseType = n.responseType),
            c && (([R, E] = yt(c, !0)), d.addEventListener("progress", R)),
            m &&
              d.upload &&
              (([h, T] = yt(m)),
              d.upload.addEventListener("progress", h),
              d.upload.addEventListener("loadend", T)),
            (n.cancelToken || n.signal) &&
              ((f = (p) => {
                d &&
                  (t(!p || p.type ? new tt(null, s, d) : p),
                  d.abort(),
                  (d = null));
              }),
              n.cancelToken && n.cancelToken.subscribe(f),
              n.signal &&
                (n.signal.aborted
                  ? f()
                  : n.signal.addEventListener("abort", f))));
          const g = fs(n.url);
          if (g && U.protocols.indexOf(g) === -1) {
            t(new A("Unsupported protocol " + g + ":", A.ERR_BAD_REQUEST, s));
            return;
          }
          d.send(i || null);
        });
      },
    bs = (s, r) => {
      const { length: e } = (s = s ? s.filter(Boolean) : []);
      if (r || e) {
        let t = new AbortController(),
          n;
        const i = function (c) {
          if (!n) {
            ((n = !0), u());
            const f = c instanceof Error ? c : this.reason;
            t.abort(
              f instanceof A ? f : new tt(f instanceof Error ? f.message : f),
            );
          }
        };
        let a =
          r &&
          setTimeout(() => {
            ((a = null), i(new A(`timeout ${r} of ms exceeded`, A.ETIMEDOUT)));
          }, r);
        const u = () => {
          s &&
            (a && clearTimeout(a),
            (a = null),
            s.forEach((c) => {
              c.unsubscribe
                ? c.unsubscribe(i)
                : c.removeEventListener("abort", i);
            }),
            (s = null));
        };
        s.forEach((c) => c.addEventListener("abort", i));
        const { signal: m } = t;
        return ((m.unsubscribe = () => l.asap(u)), m);
      }
    },
    Rs = function* (s, r) {
      let e = s.byteLength;
      if (e < r) {
        yield s;
        return;
      }
      let t = 0,
        n;
      for (; t < e; ) ((n = t + r), yield s.slice(t, n), (t = n));
    },
    ys = async function* (s, r) {
      for await (const e of As(s)) yield* Rs(e, r);
    },
    As = async function* (s) {
      if (s[Symbol.asyncIterator]) {
        yield* s;
        return;
      }
      const r = s.getReader();
      try {
        for (;;) {
          const { done: e, value: t } = await r.read();
          if (e) break;
          yield t;
        }
      } finally {
        await r.cancel();
      }
    },
    Ce = (s, r, e, t) => {
      const n = ys(s, r);
      let i = 0,
        a,
        u = (m) => {
          a || ((a = !0), t && t(m));
        };
      return new ReadableStream(
        {
          async pull(m) {
            try {
              const { done: c, value: f } = await n.next();
              if (c) {
                (u(), m.close());
                return;
              }
              let h = f.byteLength;
              if (e) {
                let R = (i += h);
                e(R);
              }
              m.enqueue(new Uint8Array(f));
            } catch (c) {
              throw (u(c), c);
            }
          },
          cancel(m) {
            return (u(m), n.return());
          },
        },
        { highWaterMark: 2 },
      );
    },
    At =
      typeof fetch == "function" &&
      typeof Request == "function" &&
      typeof Response == "function",
    _e = At && typeof ReadableStream == "function",
    ws =
      At &&
      (typeof TextEncoder == "function"
        ? (
            (s) => (r) =>
              s.encode(r)
          )(new TextEncoder())
        : async (s) => new Uint8Array(await new Response(s).arrayBuffer())),
    xe = (s, ...r) => {
      try {
        return !!s(...r);
      } catch {
        return !1;
      }
    },
    Os =
      _e &&
      xe(() => {
        let s = !1;
        const r = new Request(U.origin, {
          body: new ReadableStream(),
          method: "POST",
          get duplex() {
            return ((s = !0), "half");
          },
        }).headers.has("Content-Type");
        return s && !r;
      }),
    ve = 64 * 1024,
    qt = _e && xe(() => l.isReadableStream(new Response("").body)),
    wt = { stream: qt && ((s) => s.body) };
  At &&
    ((s) => {
      ["text", "arrayBuffer", "blob", "formData", "stream"].forEach((r) => {
        !wt[r] &&
          (wt[r] = l.isFunction(s[r])
            ? (e) => e[r]()
            : (e, t) => {
                throw new A(
                  `Response type '${r}' is not supported`,
                  A.ERR_NOT_SUPPORT,
                  t,
                );
              });
      });
    })(new Response());
  const Ss = async (s) => {
      if (s == null) return 0;
      if (l.isBlob(s)) return s.size;
      if (l.isSpecCompliantForm(s))
        return (
          await new Request(U.origin, { method: "POST", body: s }).arrayBuffer()
        ).byteLength;
      if (l.isArrayBufferView(s) || l.isArrayBuffer(s)) return s.byteLength;
      if ((l.isURLSearchParams(s) && (s = s + ""), l.isString(s)))
        return (await ws(s)).byteLength;
    },
    Ns = async (s, r) => {
      const e = l.toFiniteNumber(s.getContentLength());
      return e ?? Ss(r);
    },
    Ht = {
      http: zr,
      xhr: Ts,
      fetch:
        At &&
        (async (s) => {
          let {
            url: r,
            method: e,
            data: t,
            signal: n,
            cancelToken: i,
            timeout: a,
            onDownloadProgress: u,
            onUploadProgress: m,
            responseType: c,
            headers: f,
            withCredentials: h = "same-origin",
            fetchOptions: R,
          } = Pe(s);
          c = c ? (c + "").toLowerCase() : "text";
          let T = bs([n, i && i.toAbortSignal()], a),
            E;
          const o =
            T &&
            T.unsubscribe &&
            (() => {
              T.unsubscribe();
            });
          let d;
          try {
            if (
              m &&
              Os &&
              e !== "get" &&
              e !== "head" &&
              (d = await Ns(f, t)) !== 0
            ) {
              let N = new Request(r, {
                  method: "POST",
                  body: t,
                  duplex: "half",
                }),
                P;
              if (
                (l.isFormData(t) &&
                  (P = N.headers.get("content-type")) &&
                  f.setContentType(P),
                N.body)
              ) {
                const [G, It] = Se(d, yt(Ne(m)));
                t = Ce(N.body, ve, G, It);
              }
            }
            l.isString(h) || (h = h ? "include" : "omit");
            const y = "credentials" in Request.prototype;
            E = new Request(r, {
              ...R,
              signal: T,
              method: e.toUpperCase(),
              headers: f.normalize().toJSON(),
              body: t,
              duplex: "half",
              credentials: y ? h : void 0,
            });
            let g = await fetch(E);
            const p = qt && (c === "stream" || c === "response");
            if (qt && (u || (p && o))) {
              const N = {};
              ["status", "statusText", "headers"].forEach((tr) => {
                N[tr] = g[tr];
              });
              const P = l.toFiniteNumber(g.headers.get("content-length")),
                [G, It] = (u && Se(P, yt(Ne(u), !0))) || [];
              g = new Response(
                Ce(g.body, ve, G, () => {
                  (It && It(), o && o());
                }),
                N,
              );
            }
            c = c || "text";
            let I = await wt[l.findKey(wt, c) || "text"](g, s);
            return (
              !p && o && o(),
              await new Promise((N, P) => {
                Oe(N, P, {
                  data: I,
                  headers: M.from(g.headers),
                  status: g.status,
                  statusText: g.statusText,
                  config: s,
                  request: E,
                });
              })
            );
          } catch (y) {
            throw (
              o && o(),
              y && y.name === "TypeError" && /fetch/i.test(y.message)
                ? Object.assign(new A("Network Error", A.ERR_NETWORK, s, E), {
                    cause: y.cause || y,
                  })
                : A.from(y, y && y.code, s, E)
            );
          }
        }),
    };
  l.forEach(Ht, (s, r) => {
    if (s) {
      try {
        Object.defineProperty(s, "name", { value: r });
      } catch {}
      Object.defineProperty(s, "adapterName", { value: r });
    }
  });
  const Ue = (s) => `- ${s}`,
    Is = (s) => l.isFunction(s) || s === null || s === !1,
    Le = {
      getAdapter: (s) => {
        s = l.isArray(s) ? s : [s];
        const { length: r } = s;
        let e, t;
        const n = {};
        for (let i = 0; i < r; i++) {
          e = s[i];
          let a;
          if (
            ((t = e),
            !Is(e) && ((t = Ht[(a = String(e)).toLowerCase()]), t === void 0))
          )
            throw new A(`Unknown adapter '${a}'`);
          if (t) break;
          n[a || "#" + i] = t;
        }
        if (!t) {
          const i = Object.entries(n).map(
            ([u, m]) =>
              `adapter ${u} ` +
              (m === !1
                ? "is not supported by the environment"
                : "is not available in the build"),
          );
          let a = r
            ? i.length > 1
              ? `since :
` +
                i.map(Ue).join(`
`)
              : " " + Ue(i[0])
            : "as no adapter specified";
          throw new A(
            "There is no suitable adapter to dispatch the request " + a,
            "ERR_NOT_SUPPORT",
          );
        }
        return t;
      },
      adapters: Ht,
    };
  function $t(s) {
    if (
      (s.cancelToken && s.cancelToken.throwIfRequested(),
      s.signal && s.signal.aborted)
    )
      throw new tt(null, s);
  }
  function Fe(s) {
    return (
      $t(s),
      (s.headers = M.from(s.headers)),
      (s.data = Bt.call(s, s.transformRequest)),
      ["post", "put", "patch"].indexOf(s.method) !== -1 &&
        s.headers.setContentType("application/x-www-form-urlencoded", !1),
      Le.getAdapter(s.adapter || ct.adapter)(s).then(
        function (t) {
          return (
            $t(s),
            (t.data = Bt.call(s, s.transformResponse, t)),
            (t.headers = M.from(t.headers)),
            t
          );
        },
        function (t) {
          return (
            we(t) ||
              ($t(s),
              t &&
                t.response &&
                ((t.response.data = Bt.call(
                  s,
                  s.transformResponse,
                  t.response,
                )),
                (t.response.headers = M.from(t.response.headers)))),
            Promise.reject(t)
          );
        },
      )
    );
  }
  const Me = "1.7.9",
    Ot = {};
  ["object", "boolean", "number", "function", "string", "symbol"].forEach(
    (s, r) => {
      Ot[s] = function (t) {
        return typeof t === s || "a" + (r < 1 ? "n " : " ") + s;
      };
    },
  );
  const Xe = {};
  ((Ot.transitional = function (r, e, t) {
    function n(i, a) {
      return (
        "[Axios v" +
        Me +
        "] Transitional option '" +
        i +
        "'" +
        a +
        (t ? ". " + t : "")
      );
    }
    return (i, a, u) => {
      if (r === !1)
        throw new A(
          n(a, " has been removed" + (e ? " in " + e : "")),
          A.ERR_DEPRECATED,
        );
      return (
        e &&
          !Xe[a] &&
          ((Xe[a] = !0),
          console.warn(
            n(
              a,
              " has been deprecated since v" +
                e +
                " and will be removed in the near future",
            ),
          )),
        r ? r(i, a, u) : !0
      );
    };
  }),
    (Ot.spelling = function (r) {
      return (e, t) => (
        console.warn(`${t} is likely a misspelling of ${r}`),
        !0
      );
    }));
  function Ds(s, r, e) {
    if (typeof s != "object")
      throw new A("options must be an object", A.ERR_BAD_OPTION_VALUE);
    const t = Object.keys(s);
    let n = t.length;
    for (; n-- > 0; ) {
      const i = t[n],
        a = r[i];
      if (a) {
        const u = s[i],
          m = u === void 0 || a(u, i, s);
        if (m !== !0)
          throw new A("option " + i + " must be " + m, A.ERR_BAD_OPTION_VALUE);
        continue;
      }
      if (e !== !0) throw new A("Unknown option " + i, A.ERR_BAD_OPTION);
    }
  }
  const St = { assertOptions: Ds, validators: Ot },
    k = St.validators;
  let Q = class {
    constructor(r) {
      ((this.defaults = r),
        (this.interceptors = { request: new be(), response: new be() }));
    }
    async request(r, e) {
      try {
        return await this._request(r, e);
      } catch (t) {
        if (t instanceof Error) {
          let n = {};
          Error.captureStackTrace
            ? Error.captureStackTrace(n)
            : (n = new Error());
          const i = n.stack ? n.stack.replace(/^.+\n/, "") : "";
          try {
            t.stack
              ? i &&
                !String(t.stack).endsWith(i.replace(/^.+\n.+\n/, "")) &&
                (t.stack +=
                  `
` + i)
              : (t.stack = i);
          } catch {}
        }
        throw t;
      }
    }
    _request(r, e) {
      (typeof r == "string" ? ((e = e || {}), (e.url = r)) : (e = r || {}),
        (e = J(this.defaults, e)));
      const { transitional: t, paramsSerializer: n, headers: i } = e;
      (t !== void 0 &&
        St.assertOptions(
          t,
          {
            silentJSONParsing: k.transitional(k.boolean),
            forcedJSONParsing: k.transitional(k.boolean),
            clarifyTimeoutError: k.transitional(k.boolean),
          },
          !1,
        ),
        n != null &&
          (l.isFunction(n)
            ? (e.paramsSerializer = { serialize: n })
            : St.assertOptions(
                n,
                { encode: k.function, serialize: k.function },
                !0,
              )),
        St.assertOptions(
          e,
          {
            baseUrl: k.spelling("baseURL"),
            withXsrfToken: k.spelling("withXSRFToken"),
          },
          !0,
        ),
        (e.method = (e.method || this.defaults.method || "get").toLowerCase()));
      let a = i && l.merge(i.common, i[e.method]);
      (i &&
        l.forEach(
          ["delete", "get", "head", "post", "put", "patch", "common"],
          (E) => {
            delete i[E];
          },
        ),
        (e.headers = M.concat(a, i)));
      const u = [];
      let m = !0;
      this.interceptors.request.forEach(function (o) {
        (typeof o.runWhen == "function" && o.runWhen(e) === !1) ||
          ((m = m && o.synchronous), u.unshift(o.fulfilled, o.rejected));
      });
      const c = [];
      this.interceptors.response.forEach(function (o) {
        c.push(o.fulfilled, o.rejected);
      });
      let f,
        h = 0,
        R;
      if (!m) {
        const E = [Fe.bind(this), void 0];
        for (
          E.unshift.apply(E, u),
            E.push.apply(E, c),
            R = E.length,
            f = Promise.resolve(e);
          h < R;
        )
          f = f.then(E[h++], E[h++]);
        return f;
      }
      R = u.length;
      let T = e;
      for (h = 0; h < R; ) {
        const E = u[h++],
          o = u[h++];
        try {
          T = E(T);
        } catch (d) {
          o.call(this, d);
          break;
        }
      }
      try {
        f = Fe.call(this, T);
      } catch (E) {
        return Promise.reject(E);
      }
      for (h = 0, R = c.length; h < R; ) f = f.then(c[h++], c[h++]);
      return f;
    }
    getUri(r) {
      r = J(this.defaults, r);
      const e = Ie(r.baseURL, r.url);
      return Te(e, r.params, r.paramsSerializer);
    }
  };
  (l.forEach(["delete", "get", "head", "options"], function (r) {
    Q.prototype[r] = function (e, t) {
      return this.request(
        J(t || {}, { method: r, url: e, data: (t || {}).data }),
      );
    };
  }),
    l.forEach(["post", "put", "patch"], function (r) {
      function e(t) {
        return function (i, a, u) {
          return this.request(
            J(u || {}, {
              method: r,
              headers: t ? { "Content-Type": "multipart/form-data" } : {},
              url: i,
              data: a,
            }),
          );
        };
      }
      ((Q.prototype[r] = e()), (Q.prototype[r + "Form"] = e(!0)));
    }));
  let Ps = class rr {
    constructor(r) {
      if (typeof r != "function")
        throw new TypeError("executor must be a function.");
      let e;
      this.promise = new Promise(function (i) {
        e = i;
      });
      const t = this;
      (this.promise.then((n) => {
        if (!t._listeners) return;
        let i = t._listeners.length;
        for (; i-- > 0; ) t._listeners[i](n);
        t._listeners = null;
      }),
        (this.promise.then = (n) => {
          let i;
          const a = new Promise((u) => {
            (t.subscribe(u), (i = u));
          }).then(n);
          return (
            (a.cancel = function () {
              t.unsubscribe(i);
            }),
            a
          );
        }),
        r(function (i, a, u) {
          t.reason || ((t.reason = new tt(i, a, u)), e(t.reason));
        }));
    }
    throwIfRequested() {
      if (this.reason) throw this.reason;
    }
    subscribe(r) {
      if (this.reason) {
        r(this.reason);
        return;
      }
      this._listeners ? this._listeners.push(r) : (this._listeners = [r]);
    }
    unsubscribe(r) {
      if (!this._listeners) return;
      const e = this._listeners.indexOf(r);
      e !== -1 && this._listeners.splice(e, 1);
    }
    toAbortSignal() {
      const r = new AbortController(),
        e = (t) => {
          r.abort(t);
        };
      return (
        this.subscribe(e),
        (r.signal.unsubscribe = () => this.unsubscribe(e)),
        r.signal
      );
    }
    static source() {
      let r;
      return {
        token: new rr(function (n) {
          r = n;
        }),
        cancel: r,
      };
    }
  };
  function Cs(s) {
    return function (e) {
      return s.apply(null, e);
    };
  }
  function _s(s) {
    return l.isObject(s) && s.isAxiosError === !0;
  }
  const kt = {
    Continue: 100,
    SwitchingProtocols: 101,
    Processing: 102,
    EarlyHints: 103,
    Ok: 200,
    Created: 201,
    Accepted: 202,
    NonAuthoritativeInformation: 203,
    NoContent: 204,
    ResetContent: 205,
    PartialContent: 206,
    MultiStatus: 207,
    AlreadyReported: 208,
    ImUsed: 226,
    MultipleChoices: 300,
    MovedPermanently: 301,
    Found: 302,
    SeeOther: 303,
    NotModified: 304,
    UseProxy: 305,
    Unused: 306,
    TemporaryRedirect: 307,
    PermanentRedirect: 308,
    BadRequest: 400,
    Unauthorized: 401,
    PaymentRequired: 402,
    Forbidden: 403,
    NotFound: 404,
    MethodNotAllowed: 405,
    NotAcceptable: 406,
    ProxyAuthenticationRequired: 407,
    RequestTimeout: 408,
    Conflict: 409,
    Gone: 410,
    LengthRequired: 411,
    PreconditionFailed: 412,
    PayloadTooLarge: 413,
    UriTooLong: 414,
    UnsupportedMediaType: 415,
    RangeNotSatisfiable: 416,
    ExpectationFailed: 417,
    ImATeapot: 418,
    MisdirectedRequest: 421,
    UnprocessableEntity: 422,
    Locked: 423,
    FailedDependency: 424,
    TooEarly: 425,
    UpgradeRequired: 426,
    PreconditionRequired: 428,
    TooManyRequests: 429,
    RequestHeaderFieldsTooLarge: 431,
    UnavailableForLegalReasons: 451,
    InternalServerError: 500,
    NotImplemented: 501,
    BadGateway: 502,
    ServiceUnavailable: 503,
    GatewayTimeout: 504,
    HttpVersionNotSupported: 505,
    VariantAlsoNegotiates: 506,
    InsufficientStorage: 507,
    LoopDetected: 508,
    NotExtended: 510,
    NetworkAuthenticationRequired: 511,
  };
  Object.entries(kt).forEach(([s, r]) => {
    kt[r] = s;
  });
  function Be(s) {
    const r = new Q(s),
      e = w(Q.prototype.request, r);
    return (
      l.extend(e, Q.prototype, r, { allOwnKeys: !0 }),
      l.extend(e, r, null, { allOwnKeys: !0 }),
      (e.create = function (n) {
        return Be(J(s, n));
      }),
      e
    );
  }
  const _ = Be(ct);
  ((_.Axios = Q),
    (_.CanceledError = tt),
    (_.CancelToken = Ps),
    (_.isCancel = we),
    (_.VERSION = Me),
    (_.toFormData = bt),
    (_.AxiosError = A),
    (_.Cancel = _.CanceledError),
    (_.all = function (r) {
      return Promise.all(r);
    }),
    (_.spread = Cs),
    (_.isAxiosError = _s),
    (_.mergeConfig = J),
    (_.AxiosHeaders = M),
    (_.formToJSON = (s) => ye(l.isHTMLForm(s) ? new FormData(s) : s)),
    (_.getAdapter = Le.getAdapter),
    (_.HttpStatusCode = kt),
    (_.default = _));
  const {
    Axios: Rn,
    AxiosError: yn,
    CanceledError: An,
    isCancel: wn,
    CancelToken: On,
    VERSION: Sn,
    all: Nn,
    Cancel: In,
    isAxiosError: Dn,
    spread: Pn,
    toFormData: Cn,
    AxiosHeaders: _n,
    HttpStatusCode: xn,
    formToJSON: vn,
    getAdapter: Un,
    mergeConfig: Ln,
  } = _;
  var qe =
    typeof globalThis < "u"
      ? globalThis
      : typeof window < "u"
        ? window
        : typeof global < "u"
          ? global
          : typeof self < "u"
            ? self
            : {};
  function Gt(s) {
    return s &&
      s.__esModule &&
      Object.prototype.hasOwnProperty.call(s, "default")
      ? s.default
      : s;
  }
  var jt, He;
  function xs() {
    if (He) return jt;
    He = 1;
    const s = new Set([
      "ENOTFOUND",
      "ENETUNREACH",
      "UNABLE_TO_GET_ISSUER_CERT",
      "UNABLE_TO_GET_CRL",
      "UNABLE_TO_DECRYPT_CERT_SIGNATURE",
      "UNABLE_TO_DECRYPT_CRL_SIGNATURE",
      "UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY",
      "CERT_SIGNATURE_FAILURE",
      "CRL_SIGNATURE_FAILURE",
      "CERT_NOT_YET_VALID",
      "CERT_HAS_EXPIRED",
      "CRL_NOT_YET_VALID",
      "CRL_HAS_EXPIRED",
      "ERROR_IN_CERT_NOT_BEFORE_FIELD",
      "ERROR_IN_CERT_NOT_AFTER_FIELD",
      "ERROR_IN_CRL_LAST_UPDATE_FIELD",
      "ERROR_IN_CRL_NEXT_UPDATE_FIELD",
      "OUT_OF_MEM",
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "SELF_SIGNED_CERT_IN_CHAIN",
      "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "CERT_CHAIN_TOO_LONG",
      "CERT_REVOKED",
      "INVALID_CA",
      "PATH_LENGTH_EXCEEDED",
      "INVALID_PURPOSE",
      "CERT_UNTRUSTED",
      "CERT_REJECTED",
      "HOSTNAME_MISMATCH",
    ]);
    return ((jt = (r) => !s.has(r && r.code)), jt);
  }
  var vs = xs();
  const Us = Gt(vs),
    Vt = "axios-retry";
  function $e(s) {
    const r = ["ERR_CANCELED", "ECONNABORTED"];
    return s.response || !s.code || r.includes(s.code) ? !1 : Us(s);
  }
  const ke = ["get", "head", "options"],
    Ls = ke.concat(["put", "delete"]);
  function zt(s) {
    return (
      s.code !== "ECONNABORTED" &&
      (!s.response ||
        s.response.status === 429 ||
        (s.response.status >= 500 && s.response.status <= 599))
    );
  }
  function Fs(s) {
    var r;
    return (r = s.config) != null && r.method
      ? zt(s) && ke.indexOf(s.config.method) !== -1
      : !1;
  }
  function Ge(s) {
    var r;
    return (r = s.config) != null && r.method
      ? zt(s) && Ls.indexOf(s.config.method) !== -1
      : !1;
  }
  function je(s) {
    return $e(s) || Ge(s);
  }
  function Yt(s = void 0) {
    var t;
    const r =
      (t = s == null ? void 0 : s.response) == null
        ? void 0
        : t.headers["retry-after"];
    if (!r) return 0;
    let e = (Number(r) || 0) * 1e3;
    return (
      e === 0 && (e = (new Date(r).valueOf() || 0) - Date.now()),
      Math.max(0, e)
    );
  }
  function Ms(s = 0, r = void 0) {
    return Math.max(0, Yt(r));
  }
  function Xs(s = 0, r = void 0, e = 100) {
    const t = 2 ** s * e,
      n = Math.max(t, Yt(r)),
      i = n * 0.2 * Math.random();
    return n + i;
  }
  function Bs(s = 100) {
    return (r = 0, e = void 0) => {
      const t = r * s;
      return Math.max(t, Yt(e));
    };
  }
  const qs = {
    retries: 3,
    retryCondition: je,
    retryDelay: Ms,
    shouldResetTimeout: !1,
    onRetry: () => {},
    onMaxRetryTimesExceeded: () => {},
    validateResponse: null,
  };
  function Hs(s, r) {
    return { ...qs, ...r, ...s[Vt] };
  }
  function Ve(s, r, e = !1) {
    const t = Hs(s, r || {});
    return (
      (t.retryCount = t.retryCount || 0),
      (!t.lastRequestTime || e) && (t.lastRequestTime = Date.now()),
      (s[Vt] = t),
      t
    );
  }
  function $s(s, r) {
    (s.defaults.agent === r.agent && delete r.agent,
      s.defaults.httpAgent === r.httpAgent && delete r.httpAgent,
      s.defaults.httpsAgent === r.httpsAgent && delete r.httpsAgent);
  }
  async function ks(s, r) {
    const { retries: e, retryCondition: t } = s,
      n = (s.retryCount || 0) < e && t(r);
    if (typeof n == "object")
      try {
        return (await n) !== !1;
      } catch {
        return !1;
      }
    return n;
  }
  async function Gs(s, r, e, t) {
    var m;
    r.retryCount += 1;
    const { retryDelay: n, shouldResetTimeout: i, onRetry: a } = r,
      u = n(r.retryCount, e);
    if (($s(s, t), !i && t.timeout && r.lastRequestTime)) {
      const c = Date.now() - r.lastRequestTime,
        f = t.timeout - c - u;
      if (f <= 0) return Promise.reject(e);
      t.timeout = f;
    }
    return (
      (t.transformRequest = [(c) => c]),
      await a(r.retryCount, e, t),
      (m = t.signal) != null && m.aborted
        ? Promise.resolve(s(t))
        : new Promise((c) => {
            var R;
            const f = () => {
                (clearTimeout(h), c(s(t)));
              },
              h = setTimeout(() => {
                var T;
                (c(s(t)),
                  (T = t.signal) != null &&
                    T.removeEventListener &&
                    t.signal.removeEventListener("abort", f));
              }, u);
            (R = t.signal) != null &&
              R.addEventListener &&
              t.signal.addEventListener("abort", f, { once: !0 });
          })
    );
  }
  async function js(s, r) {
    s.retryCount >= s.retries &&
      (await s.onMaxRetryTimesExceeded(r, s.retryCount));
  }
  const z = (s, r) => {
    const e = s.interceptors.request.use((n) => {
        var i;
        return (
          Ve(n, r, !0),
          (i = n[Vt]) != null &&
            i.validateResponse &&
            (n.validateStatus = () => !1),
          n
        );
      }),
      t = s.interceptors.response.use(null, async (n) => {
        var u;
        const { config: i } = n;
        if (!i) return Promise.reject(n);
        const a = Ve(i, r);
        return n.response &&
          (u = a.validateResponse) != null &&
          u.call(a, n.response)
          ? n.response
          : (await ks(a, n))
            ? Gs(s, a, n, i)
            : (await js(a, n), Promise.reject(n));
      });
    return { requestInterceptorId: e, responseInterceptorId: t };
  };
  ((z.isNetworkError = $e),
    (z.isSafeRequestError = Fs),
    (z.isIdempotentRequestError = Ge),
    (z.isNetworkOrIdempotentRequestError = je),
    (z.exponentialDelay = Xs),
    (z.linearDelay = Bs),
    (z.isRetryableError = zt));
  var Kt = (function () {
    function s() {
      this.listeners = {};
    }
    var r = s.prototype;
    return (
      (r.on = function (t, n) {
        (this.listeners[t] || (this.listeners[t] = []),
          this.listeners[t].push(n));
      }),
      (r.off = function (t, n) {
        if (!this.listeners[t]) return !1;
        var i = this.listeners[t].indexOf(n);
        return (
          (this.listeners[t] = this.listeners[t].slice(0)),
          this.listeners[t].splice(i, 1),
          i > -1
        );
      }),
      (r.trigger = function (t) {
        var n = this.listeners[t];
        if (n)
          if (arguments.length === 2)
            for (var i = n.length, a = 0; a < i; ++a)
              n[a].call(this, arguments[1]);
          else
            for (
              var u = Array.prototype.slice.call(arguments, 1),
                m = n.length,
                c = 0;
              c < m;
              ++c
            )
              n[c].apply(this, u);
      }),
      (r.dispose = function () {
        this.listeners = {};
      }),
      (r.pipe = function (t) {
        this.on("data", function (n) {
          t.push(n);
        });
      }),
      s
    );
  })();
  function et() {
    return (
      (et = Object.assign
        ? Object.assign.bind()
        : function (s) {
            for (var r = 1; r < arguments.length; r++) {
              var e = arguments[r];
              for (var t in e) ({}).hasOwnProperty.call(e, t) && (s[t] = e[t]);
            }
            return s;
          }),
      et.apply(null, arguments)
    );
  }
  var Wt, ze;
  function Vs() {
    if (ze) return Wt;
    ze = 1;
    var s;
    return (
      typeof window < "u"
        ? (s = window)
        : typeof qe < "u"
          ? (s = qe)
          : typeof self < "u"
            ? (s = self)
            : (s = {}),
      (Wt = s),
      Wt
    );
  }
  var zs = Vs();
  const Ye = Gt(zs);
  var Ys = function (r) {
    return Ye.atob ? Ye.atob(r) : Buffer.from(r, "base64").toString("binary");
  };
  function Ks(s) {
    for (var r = Ys(s), e = new Uint8Array(r.length), t = 0; t < r.length; t++)
      e[t] = r.charCodeAt(t);
    return e;
  }
  /*! @name m3u8-parser @version 7.2.0 @license Apache-2.0 */ class Ws extends Kt {
    constructor() {
      (super(), (this.buffer = ""));
    }
    push(r) {
      let e;
      for (
        this.buffer += r,
          e = this.buffer.indexOf(`
`);
        e > -1;
        e = this.buffer.indexOf(`
`)
      )
        (this.trigger("data", this.buffer.substring(0, e)),
          (this.buffer = this.buffer.substring(e + 1)));
    }
  }
  const Js = "	",
    Jt = function (s) {
      const r = /([0-9.]*)?@?([0-9.]*)?/.exec(s || ""),
        e = {};
      return (
        r[1] && (e.length = parseInt(r[1], 10)),
        r[2] && (e.offset = parseInt(r[2], 10)),
        e
      );
    },
    Qs = function () {
      const e = "(?:" + "[^=]*" + ")=(?:" + '"[^"]*"|[^,]*' + ")";
      return new RegExp("(?:^|,)(" + e + ")");
    },
    L = function (s) {
      const r = {};
      if (!s) return r;
      const e = s.split(Qs());
      let t = e.length,
        n;
      for (; t--; )
        e[t] !== "" &&
          ((n = /([^=]*)=(.*)/.exec(e[t]).slice(1)),
          (n[0] = n[0].replace(/^\s+|\s+$/g, "")),
          (n[1] = n[1].replace(/^\s+|\s+$/g, "")),
          (n[1] = n[1].replace(/^['"](.*)['"]$/g, "$1")),
          (r[n[0]] = n[1]));
      return r;
    },
    Ke = (s) => {
      const r = s.split("x"),
        e = {};
      return (
        r[0] && (e.width = parseInt(r[0], 10)),
        r[1] && (e.height = parseInt(r[1], 10)),
        e
      );
    };
  class Zs extends Kt {
    constructor() {
      (super(), (this.customParsers = []), (this.tagMappers = []));
    }
    push(r) {
      let e, t;
      if (((r = r.trim()), r.length === 0)) return;
      if (r[0] !== "#") {
        this.trigger("data", { type: "uri", uri: r });
        return;
      }
      this.tagMappers
        .reduce(
          (i, a) => {
            const u = a(r);
            return u === r ? i : i.concat([u]);
          },
          [r],
        )
        .forEach((i) => {
          for (let a = 0; a < this.customParsers.length; a++)
            if (this.customParsers[a].call(this, i)) return;
          if (i.indexOf("#EXT") !== 0) {
            this.trigger("data", { type: "comment", text: i.slice(1) });
            return;
          }
          if (((i = i.replace("\r", "")), (e = /^#EXTM3U/.exec(i)), e)) {
            this.trigger("data", { type: "tag", tagType: "m3u" });
            return;
          }
          if (((e = /^#EXTINF:([0-9\.]*)?,?(.*)?$/.exec(i)), e)) {
            ((t = { type: "tag", tagType: "inf" }),
              e[1] && (t.duration = parseFloat(e[1])),
              e[2] && (t.title = e[2]),
              this.trigger("data", t));
            return;
          }
          if (((e = /^#EXT-X-TARGETDURATION:([0-9.]*)?/.exec(i)), e)) {
            ((t = { type: "tag", tagType: "targetduration" }),
              e[1] && (t.duration = parseInt(e[1], 10)),
              this.trigger("data", t));
            return;
          }
          if (((e = /^#EXT-X-VERSION:([0-9.]*)?/.exec(i)), e)) {
            ((t = { type: "tag", tagType: "version" }),
              e[1] && (t.version = parseInt(e[1], 10)),
              this.trigger("data", t));
            return;
          }
          if (((e = /^#EXT-X-MEDIA-SEQUENCE:(\-?[0-9.]*)?/.exec(i)), e)) {
            ((t = { type: "tag", tagType: "media-sequence" }),
              e[1] && (t.number = parseInt(e[1], 10)),
              this.trigger("data", t));
            return;
          }
          if (
            ((e = /^#EXT-X-DISCONTINUITY-SEQUENCE:(\-?[0-9.]*)?/.exec(i)), e)
          ) {
            ((t = { type: "tag", tagType: "discontinuity-sequence" }),
              e[1] && (t.number = parseInt(e[1], 10)),
              this.trigger("data", t));
            return;
          }
          if (((e = /^#EXT-X-PLAYLIST-TYPE:(.*)?$/.exec(i)), e)) {
            ((t = { type: "tag", tagType: "playlist-type" }),
              e[1] && (t.playlistType = e[1]),
              this.trigger("data", t));
            return;
          }
          if (((e = /^#EXT-X-BYTERANGE:(.*)?$/.exec(i)), e)) {
            ((t = et(Jt(e[1]), { type: "tag", tagType: "byterange" })),
              this.trigger("data", t));
            return;
          }
          if (((e = /^#EXT-X-ALLOW-CACHE:(YES|NO)?/.exec(i)), e)) {
            ((t = { type: "tag", tagType: "allow-cache" }),
              e[1] && (t.allowed = !/NO/.test(e[1])),
              this.trigger("data", t));
            return;
          }
          if (((e = /^#EXT-X-MAP:(.*)$/.exec(i)), e)) {
            if (((t = { type: "tag", tagType: "map" }), e[1])) {
              const a = L(e[1]);
              (a.URI && (t.uri = a.URI),
                a.BYTERANGE && (t.byterange = Jt(a.BYTERANGE)));
            }
            this.trigger("data", t);
            return;
          }
          if (((e = /^#EXT-X-STREAM-INF:(.*)$/.exec(i)), e)) {
            ((t = { type: "tag", tagType: "stream-inf" }),
              e[1] &&
                ((t.attributes = L(e[1])),
                t.attributes.RESOLUTION &&
                  (t.attributes.RESOLUTION = Ke(t.attributes.RESOLUTION)),
                t.attributes.BANDWIDTH &&
                  (t.attributes.BANDWIDTH = parseInt(
                    t.attributes.BANDWIDTH,
                    10,
                  )),
                t.attributes["FRAME-RATE"] &&
                  (t.attributes["FRAME-RATE"] = parseFloat(
                    t.attributes["FRAME-RATE"],
                  )),
                t.attributes["PROGRAM-ID"] &&
                  (t.attributes["PROGRAM-ID"] = parseInt(
                    t.attributes["PROGRAM-ID"],
                    10,
                  ))),
              this.trigger("data", t));
            return;
          }
          if (((e = /^#EXT-X-MEDIA:(.*)$/.exec(i)), e)) {
            ((t = { type: "tag", tagType: "media" }),
              e[1] && (t.attributes = L(e[1])),
              this.trigger("data", t));
            return;
          }
          if (((e = /^#EXT-X-ENDLIST/.exec(i)), e)) {
            this.trigger("data", { type: "tag", tagType: "endlist" });
            return;
          }
          if (((e = /^#EXT-X-DISCONTINUITY/.exec(i)), e)) {
            this.trigger("data", { type: "tag", tagType: "discontinuity" });
            return;
          }
          if (((e = /^#EXT-X-PROGRAM-DATE-TIME:(.*)$/.exec(i)), e)) {
            ((t = { type: "tag", tagType: "program-date-time" }),
              e[1] &&
                ((t.dateTimeString = e[1]),
                (t.dateTimeObject = new Date(e[1]))),
              this.trigger("data", t));
            return;
          }
          if (((e = /^#EXT-X-KEY:(.*)$/.exec(i)), e)) {
            ((t = { type: "tag", tagType: "key" }),
              e[1] &&
                ((t.attributes = L(e[1])),
                t.attributes.IV &&
                  (t.attributes.IV.substring(0, 2).toLowerCase() === "0x" &&
                    (t.attributes.IV = t.attributes.IV.substring(2)),
                  (t.attributes.IV = t.attributes.IV.match(/.{8}/g)),
                  (t.attributes.IV[0] = parseInt(t.attributes.IV[0], 16)),
                  (t.attributes.IV[1] = parseInt(t.attributes.IV[1], 16)),
                  (t.attributes.IV[2] = parseInt(t.attributes.IV[2], 16)),
                  (t.attributes.IV[3] = parseInt(t.attributes.IV[3], 16)),
                  (t.attributes.IV = new Uint32Array(t.attributes.IV)))),
              this.trigger("data", t));
            return;
          }
          if (((e = /^#EXT-X-START:(.*)$/.exec(i)), e)) {
            ((t = { type: "tag", tagType: "start" }),
              e[1] &&
                ((t.attributes = L(e[1])),
                (t.attributes["TIME-OFFSET"] = parseFloat(
                  t.attributes["TIME-OFFSET"],
                )),
                (t.attributes.PRECISE = /YES/.test(t.attributes.PRECISE))),
              this.trigger("data", t));
            return;
          }
          if (((e = /^#EXT-X-CUE-OUT-CONT:(.*)?$/.exec(i)), e)) {
            ((t = { type: "tag", tagType: "cue-out-cont" }),
              e[1] ? (t.data = e[1]) : (t.data = ""),
              this.trigger("data", t));
            return;
          }
          if (((e = /^#EXT-X-CUE-OUT:(.*)?$/.exec(i)), e)) {
            ((t = { type: "tag", tagType: "cue-out" }),
              e[1] ? (t.data = e[1]) : (t.data = ""),
              this.trigger("data", t));
            return;
          }
          if (((e = /^#EXT-X-CUE-IN:?(.*)?$/.exec(i)), e)) {
            ((t = { type: "tag", tagType: "cue-in" }),
              e[1] ? (t.data = e[1]) : (t.data = ""),
              this.trigger("data", t));
            return;
          }
          if (((e = /^#EXT-X-SKIP:(.*)$/.exec(i)), e && e[1])) {
            ((t = { type: "tag", tagType: "skip" }),
              (t.attributes = L(e[1])),
              t.attributes.hasOwnProperty("SKIPPED-SEGMENTS") &&
                (t.attributes["SKIPPED-SEGMENTS"] = parseInt(
                  t.attributes["SKIPPED-SEGMENTS"],
                  10,
                )),
              t.attributes.hasOwnProperty("RECENTLY-REMOVED-DATERANGES") &&
                (t.attributes["RECENTLY-REMOVED-DATERANGES"] =
                  t.attributes["RECENTLY-REMOVED-DATERANGES"].split(Js)),
              this.trigger("data", t));
            return;
          }
          if (((e = /^#EXT-X-PART:(.*)$/.exec(i)), e && e[1])) {
            ((t = { type: "tag", tagType: "part" }),
              (t.attributes = L(e[1])),
              ["DURATION"].forEach(function (a) {
                t.attributes.hasOwnProperty(a) &&
                  (t.attributes[a] = parseFloat(t.attributes[a]));
              }),
              ["INDEPENDENT", "GAP"].forEach(function (a) {
                t.attributes.hasOwnProperty(a) &&
                  (t.attributes[a] = /YES/.test(t.attributes[a]));
              }),
              t.attributes.hasOwnProperty("BYTERANGE") &&
                (t.attributes.byterange = Jt(t.attributes.BYTERANGE)),
              this.trigger("data", t));
            return;
          }
          if (((e = /^#EXT-X-SERVER-CONTROL:(.*)$/.exec(i)), e && e[1])) {
            ((t = { type: "tag", tagType: "server-control" }),
              (t.attributes = L(e[1])),
              ["CAN-SKIP-UNTIL", "PART-HOLD-BACK", "HOLD-BACK"].forEach(
                function (a) {
                  t.attributes.hasOwnProperty(a) &&
                    (t.attributes[a] = parseFloat(t.attributes[a]));
                },
              ),
              ["CAN-SKIP-DATERANGES", "CAN-BLOCK-RELOAD"].forEach(function (a) {
                t.attributes.hasOwnProperty(a) &&
                  (t.attributes[a] = /YES/.test(t.attributes[a]));
              }),
              this.trigger("data", t));
            return;
          }
          if (((e = /^#EXT-X-PART-INF:(.*)$/.exec(i)), e && e[1])) {
            ((t = { type: "tag", tagType: "part-inf" }),
              (t.attributes = L(e[1])),
              ["PART-TARGET"].forEach(function (a) {
                t.attributes.hasOwnProperty(a) &&
                  (t.attributes[a] = parseFloat(t.attributes[a]));
              }),
              this.trigger("data", t));
            return;
          }
          if (((e = /^#EXT-X-PRELOAD-HINT:(.*)$/.exec(i)), e && e[1])) {
            ((t = { type: "tag", tagType: "preload-hint" }),
              (t.attributes = L(e[1])),
              ["BYTERANGE-START", "BYTERANGE-LENGTH"].forEach(function (a) {
                if (t.attributes.hasOwnProperty(a)) {
                  t.attributes[a] = parseInt(t.attributes[a], 10);
                  const u = a === "BYTERANGE-LENGTH" ? "length" : "offset";
                  ((t.attributes.byterange = t.attributes.byterange || {}),
                    (t.attributes.byterange[u] = t.attributes[a]),
                    delete t.attributes[a]);
                }
              }),
              this.trigger("data", t));
            return;
          }
          if (((e = /^#EXT-X-RENDITION-REPORT:(.*)$/.exec(i)), e && e[1])) {
            ((t = { type: "tag", tagType: "rendition-report" }),
              (t.attributes = L(e[1])),
              ["LAST-MSN", "LAST-PART"].forEach(function (a) {
                t.attributes.hasOwnProperty(a) &&
                  (t.attributes[a] = parseInt(t.attributes[a], 10));
              }),
              this.trigger("data", t));
            return;
          }
          if (((e = /^#EXT-X-DATERANGE:(.*)$/.exec(i)), e && e[1])) {
            ((t = { type: "tag", tagType: "daterange" }),
              (t.attributes = L(e[1])),
              ["ID", "CLASS"].forEach(function (u) {
                t.attributes.hasOwnProperty(u) &&
                  (t.attributes[u] = String(t.attributes[u]));
              }),
              ["START-DATE", "END-DATE"].forEach(function (u) {
                t.attributes.hasOwnProperty(u) &&
                  (t.attributes[u] = new Date(t.attributes[u]));
              }),
              ["DURATION", "PLANNED-DURATION"].forEach(function (u) {
                t.attributes.hasOwnProperty(u) &&
                  (t.attributes[u] = parseFloat(t.attributes[u]));
              }),
              ["END-ON-NEXT"].forEach(function (u) {
                t.attributes.hasOwnProperty(u) &&
                  (t.attributes[u] = /YES/i.test(t.attributes[u]));
              }),
              ["SCTE35-CMD", " SCTE35-OUT", "SCTE35-IN"].forEach(function (u) {
                t.attributes.hasOwnProperty(u) &&
                  (t.attributes[u] = t.attributes[u].toString(16));
              }));
            const a = /^X-([A-Z]+-)+[A-Z]+$/;
            for (const u in t.attributes) {
              if (!a.test(u)) continue;
              const m = /[0-9A-Fa-f]{6}/g.test(t.attributes[u]),
                c = /^\d+(\.\d+)?$/.test(t.attributes[u]);
              t.attributes[u] = m
                ? t.attributes[u].toString(16)
                : c
                  ? parseFloat(t.attributes[u])
                  : String(t.attributes[u]);
            }
            this.trigger("data", t);
            return;
          }
          if (((e = /^#EXT-X-INDEPENDENT-SEGMENTS/.exec(i)), e)) {
            this.trigger("data", {
              type: "tag",
              tagType: "independent-segments",
            });
            return;
          }
          if (((e = /^#EXT-X-I-FRAMES-ONLY/.exec(i)), e)) {
            this.trigger("data", { type: "tag", tagType: "i-frames-only" });
            return;
          }
          if (((e = /^#EXT-X-CONTENT-STEERING:(.*)$/.exec(i)), e)) {
            ((t = { type: "tag", tagType: "content-steering" }),
              (t.attributes = L(e[1])),
              this.trigger("data", t));
            return;
          }
          if (((e = /^#EXT-X-I-FRAME-STREAM-INF:(.*)$/.exec(i)), e)) {
            ((t = { type: "tag", tagType: "i-frame-playlist" }),
              (t.attributes = L(e[1])),
              t.attributes.URI && (t.uri = t.attributes.URI),
              t.attributes.BANDWIDTH &&
                (t.attributes.BANDWIDTH = parseInt(t.attributes.BANDWIDTH, 10)),
              t.attributes.RESOLUTION &&
                (t.attributes.RESOLUTION = Ke(t.attributes.RESOLUTION)),
              t.attributes["AVERAGE-BANDWIDTH"] &&
                (t.attributes["AVERAGE-BANDWIDTH"] = parseInt(
                  t.attributes["AVERAGE-BANDWIDTH"],
                  10,
                )),
              t.attributes["FRAME-RATE"] &&
                (t.attributes["FRAME-RATE"] = parseFloat(
                  t.attributes["FRAME-RATE"],
                )),
              this.trigger("data", t));
            return;
          }
          if (((e = /^#EXT-X-DEFINE:(.*)$/.exec(i)), e)) {
            ((t = { type: "tag", tagType: "define" }),
              (t.attributes = L(e[1])),
              this.trigger("data", t));
            return;
          }
          this.trigger("data", { type: "tag", data: i.slice(4) });
        });
    }
    addParser({ expression: r, customType: e, dataParser: t, segment: n }) {
      (typeof t != "function" && (t = (i) => i),
        this.customParsers.push((i) => {
          if (r.exec(i))
            return (
              this.trigger("data", {
                type: "custom",
                data: t(i),
                customType: e,
                segment: n,
              }),
              !0
            );
        }));
    }
    addTagMapper({ expression: r, map: e }) {
      const t = (n) => (r.test(n) ? e(n) : n);
      this.tagMappers.push(t);
    }
  }
  const tn = (s) =>
      s.toLowerCase().replace(/-(\w)/g, (r) => r[1].toUpperCase()),
    Y = function (s) {
      const r = {};
      return (
        Object.keys(s).forEach(function (e) {
          r[tn(e)] = s[e];
        }),
        r
      );
    },
    Qt = function (s) {
      const { serverControl: r, targetDuration: e, partTargetDuration: t } = s;
      if (!r) return;
      const n = "#EXT-X-SERVER-CONTROL",
        i = "holdBack",
        a = "partHoldBack",
        u = e && e * 3,
        m = t && t * 2;
      (e &&
        !r.hasOwnProperty(i) &&
        ((r[i] = u),
        this.trigger("info", {
          message: `${n} defaulting HOLD-BACK to targetDuration * 3 (${u}).`,
        })),
        u &&
          r[i] < u &&
          (this.trigger("warn", {
            message: `${n} clamping HOLD-BACK (${r[i]}) to targetDuration * 3 (${u})`,
          }),
          (r[i] = u)),
        t &&
          !r.hasOwnProperty(a) &&
          ((r[a] = t * 3),
          this.trigger("info", {
            message: `${n} defaulting PART-HOLD-BACK to partTargetDuration * 3 (${r[a]}).`,
          })),
        t &&
          r[a] < m &&
          (this.trigger("warn", {
            message: `${n} clamping PART-HOLD-BACK (${r[a]}) to partTargetDuration * 2 (${m}).`,
          }),
          (r[a] = m)));
    };
  class en extends Kt {
    constructor(r = {}) {
      (super(),
        (this.lineStream = new Ws()),
        (this.parseStream = new Zs()),
        this.lineStream.pipe(this.parseStream),
        (this.mainDefinitions = r.mainDefinitions || {}),
        (this.params = new URL(r.uri, "https://a.com").searchParams),
        (this.lastProgramDateTime = null));
      const e = this,
        t = [];
      let n = {},
        i,
        a,
        u = !1;
      const m = function () {},
        c = { AUDIO: {}, VIDEO: {}, "CLOSED-CAPTIONS": {}, SUBTITLES: {} },
        f = "urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed";
      let h = 0;
      this.manifest = {
        allowCache: !0,
        discontinuityStarts: [],
        dateRanges: [],
        iFramePlaylists: [],
        segments: [],
      };
      let R = 0,
        T = 0;
      const E = {};
      (this.on("end", () => {
        n.uri ||
          (!n.parts && !n.preloadHints) ||
          (!n.map && i && (n.map = i),
          !n.key && a && (n.key = a),
          !n.timeline && typeof h == "number" && (n.timeline = h),
          (this.manifest.preloadSegment = n));
      }),
        this.parseStream.on("data", function (o) {
          let d, y;
          if (e.manifest.definitions) {
            for (const g in e.manifest.definitions)
              if (
                (o.uri &&
                  (o.uri = o.uri.replace(`{$${g}}`, e.manifest.definitions[g])),
                o.attributes)
              )
                for (const p in o.attributes)
                  typeof o.attributes[p] == "string" &&
                    (o.attributes[p] = o.attributes[p].replace(
                      `{$${g}}`,
                      e.manifest.definitions[g],
                    ));
          }
          ({
            tag() {
              (
                ({
                  version() {
                    o.version && (this.manifest.version = o.version);
                  },
                  "allow-cache"() {
                    ((this.manifest.allowCache = o.allowed),
                      "allowed" in o ||
                        (this.trigger("info", {
                          message: "defaulting allowCache to YES",
                        }),
                        (this.manifest.allowCache = !0)));
                  },
                  byterange() {
                    const g = {};
                    ("length" in o &&
                      ((n.byterange = g),
                      (g.length = o.length),
                      "offset" in o || (o.offset = R)),
                      "offset" in o &&
                        ((n.byterange = g), (g.offset = o.offset)),
                      (R = g.offset + g.length));
                  },
                  endlist() {
                    this.manifest.endList = !0;
                  },
                  inf() {
                    ("mediaSequence" in this.manifest ||
                      ((this.manifest.mediaSequence = 0),
                      this.trigger("info", {
                        message: "defaulting media sequence to zero",
                      })),
                      "discontinuitySequence" in this.manifest ||
                        ((this.manifest.discontinuitySequence = 0),
                        this.trigger("info", {
                          message: "defaulting discontinuity sequence to zero",
                        })),
                      o.title && (n.title = o.title),
                      o.duration > 0 && (n.duration = o.duration),
                      o.duration === 0 &&
                        ((n.duration = 0.01),
                        this.trigger("info", {
                          message:
                            "updating zero segment duration to a small value",
                        })),
                      (this.manifest.segments = t));
                  },
                  key() {
                    if (!o.attributes) {
                      this.trigger("warn", {
                        message:
                          "ignoring key declaration without attribute list",
                      });
                      return;
                    }
                    if (o.attributes.METHOD === "NONE") {
                      a = null;
                      return;
                    }
                    if (!o.attributes.URI) {
                      this.trigger("warn", {
                        message: "ignoring key declaration without URI",
                      });
                      return;
                    }
                    if (
                      o.attributes.KEYFORMAT ===
                      "com.apple.streamingkeydelivery"
                    ) {
                      ((this.manifest.contentProtection =
                        this.manifest.contentProtection || {}),
                        (this.manifest.contentProtection["com.apple.fps.1_0"] =
                          { attributes: o.attributes }));
                      return;
                    }
                    if (o.attributes.KEYFORMAT === "com.microsoft.playready") {
                      ((this.manifest.contentProtection =
                        this.manifest.contentProtection || {}),
                        (this.manifest.contentProtection[
                          "com.microsoft.playready"
                        ] = { uri: o.attributes.URI }));
                      return;
                    }
                    if (o.attributes.KEYFORMAT === f) {
                      if (
                        [
                          "SAMPLE-AES",
                          "SAMPLE-AES-CTR",
                          "SAMPLE-AES-CENC",
                        ].indexOf(o.attributes.METHOD) === -1
                      ) {
                        this.trigger("warn", {
                          message: "invalid key method provided for Widevine",
                        });
                        return;
                      }
                      if (
                        (o.attributes.METHOD === "SAMPLE-AES-CENC" &&
                          this.trigger("warn", {
                            message:
                              "SAMPLE-AES-CENC is deprecated, please use SAMPLE-AES-CTR instead",
                          }),
                        o.attributes.URI.substring(0, 23) !==
                          "data:text/plain;base64,")
                      ) {
                        this.trigger("warn", {
                          message: "invalid key URI provided for Widevine",
                        });
                        return;
                      }
                      if (
                        !(
                          o.attributes.KEYID &&
                          o.attributes.KEYID.substring(0, 2) === "0x"
                        )
                      ) {
                        this.trigger("warn", {
                          message: "invalid key ID provided for Widevine",
                        });
                        return;
                      }
                      ((this.manifest.contentProtection =
                        this.manifest.contentProtection || {}),
                        (this.manifest.contentProtection["com.widevine.alpha"] =
                          {
                            attributes: {
                              schemeIdUri: o.attributes.KEYFORMAT,
                              keyId: o.attributes.KEYID.substring(2),
                            },
                            pssh: Ks(o.attributes.URI.split(",")[1]),
                          }));
                      return;
                    }
                    (o.attributes.METHOD ||
                      this.trigger("warn", {
                        message: "defaulting key method to AES-128",
                      }),
                      (a = {
                        method: o.attributes.METHOD || "AES-128",
                        uri: o.attributes.URI,
                      }),
                      typeof o.attributes.IV < "u" && (a.iv = o.attributes.IV));
                  },
                  "media-sequence"() {
                    if (!isFinite(o.number)) {
                      this.trigger("warn", {
                        message: "ignoring invalid media sequence: " + o.number,
                      });
                      return;
                    }
                    this.manifest.mediaSequence = o.number;
                  },
                  "discontinuity-sequence"() {
                    if (!isFinite(o.number)) {
                      this.trigger("warn", {
                        message:
                          "ignoring invalid discontinuity sequence: " +
                          o.number,
                      });
                      return;
                    }
                    ((this.manifest.discontinuitySequence = o.number),
                      (h = o.number));
                  },
                  "playlist-type"() {
                    if (!/VOD|EVENT/.test(o.playlistType)) {
                      this.trigger("warn", {
                        message:
                          "ignoring unknown playlist type: " + o.playlist,
                      });
                      return;
                    }
                    this.manifest.playlistType = o.playlistType;
                  },
                  map() {
                    ((i = {}),
                      o.uri && (i.uri = o.uri),
                      o.byterange && (i.byterange = o.byterange),
                      a && (i.key = a));
                  },
                  "stream-inf"() {
                    if (
                      ((this.manifest.playlists = t),
                      (this.manifest.mediaGroups =
                        this.manifest.mediaGroups || c),
                      !o.attributes)
                    ) {
                      this.trigger("warn", {
                        message: "ignoring empty stream-inf attributes",
                      });
                      return;
                    }
                    (n.attributes || (n.attributes = {}),
                      et(n.attributes, o.attributes));
                  },
                  media() {
                    if (
                      ((this.manifest.mediaGroups =
                        this.manifest.mediaGroups || c),
                      !(
                        o.attributes &&
                        o.attributes.TYPE &&
                        o.attributes["GROUP-ID"] &&
                        o.attributes.NAME
                      ))
                    ) {
                      this.trigger("warn", {
                        message: "ignoring incomplete or missing media group",
                      });
                      return;
                    }
                    const g = this.manifest.mediaGroups[o.attributes.TYPE];
                    ((g[o.attributes["GROUP-ID"]] =
                      g[o.attributes["GROUP-ID"]] || {}),
                      (d = g[o.attributes["GROUP-ID"]]),
                      (y = { default: /yes/i.test(o.attributes.DEFAULT) }),
                      y.default
                        ? (y.autoselect = !0)
                        : (y.autoselect = /yes/i.test(o.attributes.AUTOSELECT)),
                      o.attributes.LANGUAGE &&
                        (y.language = o.attributes.LANGUAGE),
                      o.attributes.URI && (y.uri = o.attributes.URI),
                      o.attributes["INSTREAM-ID"] &&
                        (y.instreamId = o.attributes["INSTREAM-ID"]),
                      o.attributes.CHARACTERISTICS &&
                        (y.characteristics = o.attributes.CHARACTERISTICS),
                      o.attributes.FORCED &&
                        (y.forced = /yes/i.test(o.attributes.FORCED)),
                      (d[o.attributes.NAME] = y));
                  },
                  discontinuity() {
                    ((h += 1),
                      (n.discontinuity = !0),
                      this.manifest.discontinuityStarts.push(t.length));
                  },
                  "program-date-time"() {
                    (typeof this.manifest.dateTimeString > "u" &&
                      ((this.manifest.dateTimeString = o.dateTimeString),
                      (this.manifest.dateTimeObject = o.dateTimeObject)),
                      (n.dateTimeString = o.dateTimeString),
                      (n.dateTimeObject = o.dateTimeObject));
                    const { lastProgramDateTime: g } = this;
                    ((this.lastProgramDateTime = new Date(
                      o.dateTimeString,
                    ).getTime()),
                      g === null &&
                        this.manifest.segments.reduceRight(
                          (p, I) => (
                            (I.programDateTime = p - I.duration * 1e3),
                            I.programDateTime
                          ),
                          this.lastProgramDateTime,
                        ));
                  },
                  targetduration() {
                    if (!isFinite(o.duration) || o.duration < 0) {
                      this.trigger("warn", {
                        message:
                          "ignoring invalid target duration: " + o.duration,
                      });
                      return;
                    }
                    ((this.manifest.targetDuration = o.duration),
                      Qt.call(this, this.manifest));
                  },
                  start() {
                    if (!o.attributes || isNaN(o.attributes["TIME-OFFSET"])) {
                      this.trigger("warn", {
                        message:
                          "ignoring start declaration without appropriate attribute list",
                      });
                      return;
                    }
                    this.manifest.start = {
                      timeOffset: o.attributes["TIME-OFFSET"],
                      precise: o.attributes.PRECISE,
                    };
                  },
                  "cue-out"() {
                    n.cueOut = o.data;
                  },
                  "cue-out-cont"() {
                    n.cueOutCont = o.data;
                  },
                  "cue-in"() {
                    n.cueIn = o.data;
                  },
                  skip() {
                    ((this.manifest.skip = Y(o.attributes)),
                      this.warnOnMissingAttributes_(
                        "#EXT-X-SKIP",
                        o.attributes,
                        ["SKIPPED-SEGMENTS"],
                      ));
                  },
                  part() {
                    u = !0;
                    const g = this.manifest.segments.length,
                      p = Y(o.attributes);
                    ((n.parts = n.parts || []),
                      n.parts.push(p),
                      p.byterange &&
                        (p.byterange.hasOwnProperty("offset") ||
                          (p.byterange.offset = T),
                        (T = p.byterange.offset + p.byterange.length)));
                    const I = n.parts.length - 1;
                    (this.warnOnMissingAttributes_(
                      `#EXT-X-PART #${I} for segment #${g}`,
                      o.attributes,
                      ["URI", "DURATION"],
                    ),
                      this.manifest.renditionReports &&
                        this.manifest.renditionReports.forEach((N, P) => {
                          N.hasOwnProperty("lastPart") ||
                            this.trigger("warn", {
                              message: `#EXT-X-RENDITION-REPORT #${P} lacks required attribute(s): LAST-PART`,
                            });
                        }));
                  },
                  "server-control"() {
                    const g = (this.manifest.serverControl = Y(o.attributes));
                    (g.hasOwnProperty("canBlockReload") ||
                      ((g.canBlockReload = !1),
                      this.trigger("info", {
                        message:
                          "#EXT-X-SERVER-CONTROL defaulting CAN-BLOCK-RELOAD to false",
                      })),
                      Qt.call(this, this.manifest),
                      g.canSkipDateranges &&
                        !g.hasOwnProperty("canSkipUntil") &&
                        this.trigger("warn", {
                          message:
                            "#EXT-X-SERVER-CONTROL lacks required attribute CAN-SKIP-UNTIL which is required when CAN-SKIP-DATERANGES is set",
                        }));
                  },
                  "preload-hint"() {
                    const g = this.manifest.segments.length,
                      p = Y(o.attributes),
                      I = p.type && p.type === "PART";
                    ((n.preloadHints = n.preloadHints || []),
                      n.preloadHints.push(p),
                      p.byterange &&
                        (p.byterange.hasOwnProperty("offset") ||
                          ((p.byterange.offset = I ? T : 0),
                          I && (T = p.byterange.offset + p.byterange.length))));
                    const N = n.preloadHints.length - 1;
                    if (
                      (this.warnOnMissingAttributes_(
                        `#EXT-X-PRELOAD-HINT #${N} for segment #${g}`,
                        o.attributes,
                        ["TYPE", "URI"],
                      ),
                      !!p.type)
                    )
                      for (let P = 0; P < n.preloadHints.length - 1; P++) {
                        const G = n.preloadHints[P];
                        G.type &&
                          G.type === p.type &&
                          this.trigger("warn", {
                            message: `#EXT-X-PRELOAD-HINT #${N} for segment #${g} has the same TYPE ${p.type} as preload hint #${P}`,
                          });
                      }
                  },
                  "rendition-report"() {
                    const g = Y(o.attributes);
                    ((this.manifest.renditionReports =
                      this.manifest.renditionReports || []),
                      this.manifest.renditionReports.push(g));
                    const p = this.manifest.renditionReports.length - 1,
                      I = ["LAST-MSN", "URI"];
                    (u && I.push("LAST-PART"),
                      this.warnOnMissingAttributes_(
                        `#EXT-X-RENDITION-REPORT #${p}`,
                        o.attributes,
                        I,
                      ));
                  },
                  "part-inf"() {
                    ((this.manifest.partInf = Y(o.attributes)),
                      this.warnOnMissingAttributes_(
                        "#EXT-X-PART-INF",
                        o.attributes,
                        ["PART-TARGET"],
                      ),
                      this.manifest.partInf.partTarget &&
                        (this.manifest.partTargetDuration =
                          this.manifest.partInf.partTarget),
                      Qt.call(this, this.manifest));
                  },
                  daterange() {
                    this.manifest.dateRanges.push(Y(o.attributes));
                    const g = this.manifest.dateRanges.length - 1;
                    this.warnOnMissingAttributes_(
                      `#EXT-X-DATERANGE #${g}`,
                      o.attributes,
                      ["ID", "START-DATE"],
                    );
                    const p = this.manifest.dateRanges[g];
                    (p.endDate &&
                      p.startDate &&
                      new Date(p.endDate) < new Date(p.startDate) &&
                      this.trigger("warn", {
                        message:
                          "EXT-X-DATERANGE END-DATE must be equal to or later than the value of the START-DATE",
                      }),
                      p.duration &&
                        p.duration < 0 &&
                        this.trigger("warn", {
                          message:
                            "EXT-X-DATERANGE DURATION must not be negative",
                        }),
                      p.plannedDuration &&
                        p.plannedDuration < 0 &&
                        this.trigger("warn", {
                          message:
                            "EXT-X-DATERANGE PLANNED-DURATION must not be negative",
                        }));
                    const I = !!p.endOnNext;
                    if (
                      (I &&
                        !p.class &&
                        this.trigger("warn", {
                          message:
                            "EXT-X-DATERANGE with an END-ON-NEXT=YES attribute must have a CLASS attribute",
                        }),
                      I &&
                        (p.duration || p.endDate) &&
                        this.trigger("warn", {
                          message:
                            "EXT-X-DATERANGE with an END-ON-NEXT=YES attribute must not contain DURATION or END-DATE attributes",
                        }),
                      p.duration && p.endDate)
                    ) {
                      const P = p.startDate.getTime() + p.duration * 1e3;
                      this.manifest.dateRanges[g].endDate = new Date(P);
                    }
                    if (!E[p.id]) E[p.id] = p;
                    else {
                      for (const P in E[p.id])
                        if (
                          p[P] &&
                          JSON.stringify(E[p.id][P]) !== JSON.stringify(p[P])
                        ) {
                          this.trigger("warn", {
                            message:
                              "EXT-X-DATERANGE tags with the same ID in a playlist must have the same attributes values",
                          });
                          break;
                        }
                      const N = this.manifest.dateRanges.findIndex(
                        (P) => P.id === p.id,
                      );
                      ((this.manifest.dateRanges[N] = et(
                        this.manifest.dateRanges[N],
                        p,
                      )),
                        (E[p.id] = et(E[p.id], p)),
                        this.manifest.dateRanges.pop());
                    }
                  },
                  "independent-segments"() {
                    this.manifest.independentSegments = !0;
                  },
                  "i-frames-only"() {
                    ((this.manifest.iFramesOnly = !0),
                      this.requiredCompatibilityversion(
                        this.manifest.version,
                        4,
                      ));
                  },
                  "content-steering"() {
                    ((this.manifest.contentSteering = Y(o.attributes)),
                      this.warnOnMissingAttributes_(
                        "#EXT-X-CONTENT-STEERING",
                        o.attributes,
                        ["SERVER-URI"],
                      ));
                  },
                  define() {
                    this.manifest.definitions = this.manifest.definitions || {};
                    const g = (p, I) => {
                      if (p in this.manifest.definitions) {
                        this.trigger("error", {
                          message: `EXT-X-DEFINE: Duplicate name ${p}`,
                        });
                        return;
                      }
                      this.manifest.definitions[p] = I;
                    };
                    if ("QUERYPARAM" in o.attributes) {
                      if ("NAME" in o.attributes || "IMPORT" in o.attributes) {
                        this.trigger("error", {
                          message: "EXT-X-DEFINE: Invalid attributes",
                        });
                        return;
                      }
                      const p = this.params.get(o.attributes.QUERYPARAM);
                      if (!p) {
                        this.trigger("error", {
                          message: `EXT-X-DEFINE: No query param ${o.attributes.QUERYPARAM}`,
                        });
                        return;
                      }
                      g(o.attributes.QUERYPARAM, decodeURIComponent(p));
                      return;
                    }
                    if ("NAME" in o.attributes) {
                      if ("IMPORT" in o.attributes) {
                        this.trigger("error", {
                          message: "EXT-X-DEFINE: Invalid attributes",
                        });
                        return;
                      }
                      if (
                        !("VALUE" in o.attributes) ||
                        typeof o.attributes.VALUE != "string"
                      ) {
                        this.trigger("error", {
                          message: `EXT-X-DEFINE: No value for ${o.attributes.NAME}`,
                        });
                        return;
                      }
                      g(o.attributes.NAME, o.attributes.VALUE);
                      return;
                    }
                    if ("IMPORT" in o.attributes) {
                      if (!this.mainDefinitions[o.attributes.IMPORT]) {
                        this.trigger("error", {
                          message: `EXT-X-DEFINE: No value ${o.attributes.IMPORT} to import, or IMPORT used on main playlist`,
                        });
                        return;
                      }
                      g(
                        o.attributes.IMPORT,
                        this.mainDefinitions[o.attributes.IMPORT],
                      );
                      return;
                    }
                    this.trigger("error", {
                      message: "EXT-X-DEFINE: No attribute",
                    });
                  },
                  "i-frame-playlist"() {
                    (this.manifest.iFramePlaylists.push({
                      attributes: o.attributes,
                      uri: o.uri,
                      timeline: h,
                    }),
                      this.warnOnMissingAttributes_(
                        "#EXT-X-I-FRAME-STREAM-INF",
                        o.attributes,
                        ["BANDWIDTH", "URI"],
                      ));
                  },
                })[o.tagType] || m
              ).call(e);
            },
            uri() {
              ((n.uri = o.uri),
                t.push(n),
                this.manifest.targetDuration &&
                  !("duration" in n) &&
                  (this.trigger("warn", {
                    message:
                      "defaulting segment duration to the target duration",
                  }),
                  (n.duration = this.manifest.targetDuration)),
                a && (n.key = a),
                (n.timeline = h),
                i && (n.map = i),
                (T = 0),
                this.lastProgramDateTime !== null &&
                  ((n.programDateTime = this.lastProgramDateTime),
                  (this.lastProgramDateTime += n.duration * 1e3)),
                (n = {}));
            },
            comment() {},
            custom() {
              o.segment
                ? ((n.custom = n.custom || {}),
                  (n.custom[o.customType] = o.data))
                : ((this.manifest.custom = this.manifest.custom || {}),
                  (this.manifest.custom[o.customType] = o.data));
            },
          })[o.type].call(e);
        }));
    }
    requiredCompatibilityversion(r, e) {
      (r < e || !r) &&
        this.trigger("warn", {
          message: `manifest must be at least version ${e}`,
        });
    }
    warnOnMissingAttributes_(r, e, t) {
      const n = [];
      (t.forEach(function (i) {
        e.hasOwnProperty(i) || n.push(i);
      }),
        n.length &&
          this.trigger("warn", {
            message: `${r} lacks required attribute(s): ${n.join(", ")}`,
          }));
    }
    push(r) {
      this.lineStream.push(r);
    }
    end() {
      (this.lineStream.push(`
`),
        this.manifest.dateRanges.length &&
          this.lastProgramDateTime === null &&
          this.trigger("warn", {
            message:
              "A playlist with EXT-X-DATERANGE tag must contain atleast one EXT-X-PROGRAM-DATE-TIME tag",
          }),
        (this.lastProgramDateTime = null),
        this.trigger("end"));
    }
    addParser(r) {
      this.parseStream.addParser(r);
    }
    addTagMapper(r) {
      this.parseStream.addTagMapper(r);
    }
  }
  var Zt = { exports: {} },
    We;
  function rn() {
    return (
      We ||
        ((We = 1),
        (function (s) {
          var r = Object.prototype.hasOwnProperty,
            e = "~";
          function t() {}
          Object.create &&
            ((t.prototype = Object.create(null)),
            new t().__proto__ || (e = !1));
          function n(m, c, f) {
            ((this.fn = m), (this.context = c), (this.once = f || !1));
          }
          function i(m, c, f, h, R) {
            if (typeof f != "function")
              throw new TypeError("The listener must be a function");
            var T = new n(f, h || m, R),
              E = e ? e + c : c;
            return (
              m._events[E]
                ? m._events[E].fn
                  ? (m._events[E] = [m._events[E], T])
                  : m._events[E].push(T)
                : ((m._events[E] = T), m._eventsCount++),
              m
            );
          }
          function a(m, c) {
            --m._eventsCount === 0
              ? (m._events = new t())
              : delete m._events[c];
          }
          function u() {
            ((this._events = new t()), (this._eventsCount = 0));
          }
          ((u.prototype.eventNames = function () {
            var c = [],
              f,
              h;
            if (this._eventsCount === 0) return c;
            for (h in (f = this._events))
              r.call(f, h) && c.push(e ? h.slice(1) : h);
            return Object.getOwnPropertySymbols
              ? c.concat(Object.getOwnPropertySymbols(f))
              : c;
          }),
            (u.prototype.listeners = function (c) {
              var f = e ? e + c : c,
                h = this._events[f];
              if (!h) return [];
              if (h.fn) return [h.fn];
              for (var R = 0, T = h.length, E = new Array(T); R < T; R++)
                E[R] = h[R].fn;
              return E;
            }),
            (u.prototype.listenerCount = function (c) {
              var f = e ? e + c : c,
                h = this._events[f];
              return h ? (h.fn ? 1 : h.length) : 0;
            }),
            (u.prototype.emit = function (c, f, h, R, T, E) {
              var o = e ? e + c : c;
              if (!this._events[o]) return !1;
              var d = this._events[o],
                y = arguments.length,
                g,
                p;
              if (d.fn) {
                switch (
                  (d.once && this.removeListener(c, d.fn, void 0, !0), y)
                ) {
                  case 1:
                    return (d.fn.call(d.context), !0);
                  case 2:
                    return (d.fn.call(d.context, f), !0);
                  case 3:
                    return (d.fn.call(d.context, f, h), !0);
                  case 4:
                    return (d.fn.call(d.context, f, h, R), !0);
                  case 5:
                    return (d.fn.call(d.context, f, h, R, T), !0);
                  case 6:
                    return (d.fn.call(d.context, f, h, R, T, E), !0);
                }
                for (p = 1, g = new Array(y - 1); p < y; p++)
                  g[p - 1] = arguments[p];
                d.fn.apply(d.context, g);
              } else {
                var I = d.length,
                  N;
                for (p = 0; p < I; p++)
                  switch (
                    (d[p].once && this.removeListener(c, d[p].fn, void 0, !0),
                    y)
                  ) {
                    case 1:
                      d[p].fn.call(d[p].context);
                      break;
                    case 2:
                      d[p].fn.call(d[p].context, f);
                      break;
                    case 3:
                      d[p].fn.call(d[p].context, f, h);
                      break;
                    case 4:
                      d[p].fn.call(d[p].context, f, h, R);
                      break;
                    default:
                      if (!g)
                        for (N = 1, g = new Array(y - 1); N < y; N++)
                          g[N - 1] = arguments[N];
                      d[p].fn.apply(d[p].context, g);
                  }
              }
              return !0;
            }),
            (u.prototype.on = function (c, f, h) {
              return i(this, c, f, h, !1);
            }),
            (u.prototype.once = function (c, f, h) {
              return i(this, c, f, h, !0);
            }),
            (u.prototype.removeListener = function (c, f, h, R) {
              var T = e ? e + c : c;
              if (!this._events[T]) return this;
              if (!f) return (a(this, T), this);
              var E = this._events[T];
              if (E.fn)
                E.fn === f &&
                  (!R || E.once) &&
                  (!h || E.context === h) &&
                  a(this, T);
              else {
                for (var o = 0, d = [], y = E.length; o < y; o++)
                  (E[o].fn !== f ||
                    (R && !E[o].once) ||
                    (h && E[o].context !== h)) &&
                    d.push(E[o]);
                d.length
                  ? (this._events[T] = d.length === 1 ? d[0] : d)
                  : a(this, T);
              }
              return this;
            }),
            (u.prototype.removeAllListeners = function (c) {
              var f;
              return (
                c
                  ? ((f = e ? e + c : c), this._events[f] && a(this, f))
                  : ((this._events = new t()), (this._eventsCount = 0)),
                this
              );
            }),
            (u.prototype.off = u.prototype.removeListener),
            (u.prototype.addListener = u.prototype.on),
            (u.prefixed = e),
            (u.EventEmitter = u),
            (s.exports = u));
        })(Zt)),
      Zt.exports
    );
  }
  var sn = rn();
  const nn = Gt(sn);
  class Je extends Error {
    constructor(r) {
      (super(r), (this.name = "TimeoutError"));
    }
  }
  class an extends Error {
    constructor(r) {
      (super(), (this.name = "AbortError"), (this.message = r));
    }
  }
  const Qe = (s) =>
      globalThis.DOMException === void 0 ? new an(s) : new DOMException(s),
    Ze = (s) => {
      const r =
        s.reason === void 0 ? Qe("This operation was aborted.") : s.reason;
      return r instanceof Error ? r : Qe(r);
    };
  function on(s, r) {
    const {
      milliseconds: e,
      fallback: t,
      message: n,
      customTimers: i = { setTimeout, clearTimeout },
    } = r;
    let a, u;
    const c = new Promise((f, h) => {
      if (typeof e != "number" || Math.sign(e) !== 1)
        throw new TypeError(
          `Expected \`milliseconds\` to be a positive number, got \`${e}\``,
        );
      if (r.signal) {
        const { signal: T } = r;
        (T.aborted && h(Ze(T)),
          (u = () => {
            h(Ze(T));
          }),
          T.addEventListener("abort", u, { once: !0 }));
      }
      if (e === Number.POSITIVE_INFINITY) {
        s.then(f, h);
        return;
      }
      const R = new Je();
      ((a = i.setTimeout.call(
        void 0,
        () => {
          if (t) {
            try {
              f(t());
            } catch (T) {
              h(T);
            }
            return;
          }
          (typeof s.cancel == "function" && s.cancel(),
            n === !1
              ? f()
              : n instanceof Error
                ? h(n)
                : ((R.message =
                    n ?? `Promise timed out after ${e} milliseconds`),
                  h(R)));
        },
        e,
      )),
        (async () => {
          try {
            f(await s);
          } catch (T) {
            h(T);
          }
        })());
    }).finally(() => {
      (c.clear(), u && r.signal && r.signal.removeEventListener("abort", u));
    });
    return (
      (c.clear = () => {
        (i.clearTimeout.call(void 0, a), (a = void 0));
      }),
      c
    );
  }
  function un(s, r, e) {
    let t = 0,
      n = s.length;
    for (; n > 0; ) {
      const i = Math.trunc(n / 2);
      let a = t + i;
      e(s[a], r) <= 0 ? ((t = ++a), (n -= i + 1)) : (n = i);
    }
    return t;
  }
  class cn {
    constructor() {
      x(this, q, []);
    }
    enqueue(r, e) {
      e = { priority: 0, ...e };
      const t = { priority: e.priority, id: e.id, run: r };
      if (this.size === 0 || b(this, q)[this.size - 1].priority >= e.priority) {
        b(this, q).push(t);
        return;
      }
      const n = un(b(this, q), t, (i, a) => a.priority - i.priority);
      b(this, q).splice(n, 0, t);
    }
    setPriority(r, e) {
      const t = b(this, q).findIndex((i) => i.id === r);
      if (t === -1)
        throw new ReferenceError(
          `No promise function with the id "${r}" exists in the queue.`,
        );
      const [n] = b(this, q).splice(t, 1);
      this.enqueue(n.run, { priority: e, id: r });
    }
    dequeue() {
      const r = b(this, q).shift();
      return r == null ? void 0 : r.run;
    }
    filter(r) {
      return b(this, q)
        .filter((e) => e.priority === r.priority)
        .map((e) => e.run);
    }
    get size() {
      return b(this, q).length;
    }
  }
  q = new WeakMap();
  class ln extends nn {
    constructor(e) {
      var t, n;
      super();
      x(this, O);
      x(this, rt);
      x(this, st);
      x(this, K, 0);
      x(this, ft);
      x(this, nt);
      x(this, dt, 0);
      x(this, H);
      x(this, it);
      x(this, F);
      x(this, ht);
      x(this, $, 0);
      x(this, at);
      x(this, V);
      x(this, pt);
      x(this, Nt, 1n);
      Dt(this, "timeout");
      if (
        ((e = {
          carryoverConcurrencyCount: !1,
          intervalCap: Number.POSITIVE_INFINITY,
          interval: 0,
          concurrency: Number.POSITIVE_INFINITY,
          autoStart: !0,
          queueClass: cn,
          ...e,
        }),
        !(typeof e.intervalCap == "number" && e.intervalCap >= 1))
      )
        throw new TypeError(
          `Expected \`intervalCap\` to be a number from 1 and up, got \`${((t = e.intervalCap) == null ? void 0 : t.toString()) ?? ""}\` (${typeof e.intervalCap})`,
        );
      if (
        e.interval === void 0 ||
        !(Number.isFinite(e.interval) && e.interval >= 0)
      )
        throw new TypeError(
          `Expected \`interval\` to be a finite number >= 0, got \`${((n = e.interval) == null ? void 0 : n.toString()) ?? ""}\` (${typeof e.interval})`,
        );
      (C(this, rt, e.carryoverConcurrencyCount),
        C(
          this,
          st,
          e.intervalCap === Number.POSITIVE_INFINITY || e.interval === 0,
        ),
        C(this, ft, e.intervalCap),
        C(this, nt, e.interval),
        C(this, F, new e.queueClass()),
        C(this, ht, e.queueClass),
        (this.concurrency = e.concurrency),
        (this.timeout = e.timeout),
        C(this, pt, e.throwOnTimeout === !0),
        C(this, V, e.autoStart === !1));
    }
    get concurrency() {
      return b(this, at);
    }
    set concurrency(e) {
      if (!(typeof e == "number" && e >= 1))
        throw new TypeError(
          `Expected \`concurrency\` to be a number from 1 and up, got \`${e}\` (${typeof e})`,
        );
      (C(this, at, e), v(this, O, Ct).call(this));
    }
    setPriority(e, t) {
      b(this, F).setPriority(e, t);
    }
    async add(e, t = {}) {
      return (
        t.id ?? (t.id = (mt(this, Nt)._++).toString()),
        (t = { timeout: this.timeout, throwOnTimeout: b(this, pt), ...t }),
        new Promise((n, i) => {
          (b(this, F).enqueue(async () => {
            var a;
            (mt(this, $)._++, mt(this, K)._++);
            try {
              (a = t.signal) == null || a.throwIfAborted();
              let u = e({ signal: t.signal });
              (t.timeout &&
                (u = on(Promise.resolve(u), { milliseconds: t.timeout })),
                t.signal &&
                  (u = Promise.race([u, v(this, O, ur).call(this, t.signal)])));
              const m = await u;
              (n(m), this.emit("completed", m));
            } catch (u) {
              if (u instanceof Je && !t.throwOnTimeout) {
                n();
                return;
              }
              (i(u), this.emit("error", u));
            } finally {
              v(this, O, ir).call(this);
            }
          }, t),
            this.emit("add"),
            v(this, O, Pt).call(this));
        })
      );
    }
    async addAll(e, t) {
      return Promise.all(e.map(async (n) => this.add(n, t)));
    }
    start() {
      return b(this, V)
        ? (C(this, V, !1), v(this, O, Ct).call(this), this)
        : this;
    }
    pause() {
      C(this, V, !0);
    }
    clear() {
      C(this, F, new (b(this, ht))());
    }
    async onEmpty() {
      b(this, F).size !== 0 && (await v(this, O, _t).call(this, "empty"));
    }
    async onSizeLessThan(e) {
      b(this, F).size < e ||
        (await v(this, O, _t).call(this, "next", () => b(this, F).size < e));
    }
    async onIdle() {
      (b(this, $) === 0 && b(this, F).size === 0) ||
        (await v(this, O, _t).call(this, "idle"));
    }
    get size() {
      return b(this, F).size;
    }
    sizeBy(e) {
      return b(this, F).filter(e).length;
    }
    get pending() {
      return b(this, $);
    }
    get isPaused() {
      return b(this, V);
    }
  }
  ((rt = new WeakMap()),
    (st = new WeakMap()),
    (K = new WeakMap()),
    (ft = new WeakMap()),
    (nt = new WeakMap()),
    (dt = new WeakMap()),
    (H = new WeakMap()),
    (it = new WeakMap()),
    (F = new WeakMap()),
    (ht = new WeakMap()),
    ($ = new WeakMap()),
    (at = new WeakMap()),
    (V = new WeakMap()),
    (pt = new WeakMap()),
    (Nt = new WeakMap()),
    (O = new WeakSet()),
    (sr = function () {
      return b(this, st) || b(this, K) < b(this, ft);
    }),
    (nr = function () {
      return b(this, $) < b(this, at);
    }),
    (ir = function () {
      (mt(this, $)._--, v(this, O, Pt).call(this), this.emit("next"));
    }),
    (ar = function () {
      (v(this, O, re).call(this),
        v(this, O, ee).call(this),
        C(this, it, void 0));
    }),
    (or = function () {
      const e = Date.now();
      if (b(this, H) === void 0) {
        const t = b(this, dt) - e;
        if (t < 0) C(this, K, b(this, rt) ? b(this, $) : 0);
        else
          return (
            b(this, it) === void 0 &&
              C(
                this,
                it,
                setTimeout(() => {
                  v(this, O, ar).call(this);
                }, t),
              ),
            !0
          );
      }
      return !1;
    }),
    (Pt = function () {
      if (b(this, F).size === 0)
        return (
          b(this, H) && clearInterval(b(this, H)),
          C(this, H, void 0),
          this.emit("empty"),
          b(this, $) === 0 && this.emit("idle"),
          !1
        );
      if (!b(this, V)) {
        const e = !b(this, O, or);
        if (b(this, O, sr) && b(this, O, nr)) {
          const t = b(this, F).dequeue();
          return t
            ? (this.emit("active"), t(), e && v(this, O, ee).call(this), !0)
            : !1;
        }
      }
      return !1;
    }),
    (ee = function () {
      b(this, st) ||
        b(this, H) !== void 0 ||
        (C(
          this,
          H,
          setInterval(
            () => {
              v(this, O, re).call(this);
            },
            b(this, nt),
          ),
        ),
        C(this, dt, Date.now() + b(this, nt)));
    }),
    (re = function () {
      (b(this, K) === 0 &&
        b(this, $) === 0 &&
        b(this, H) &&
        (clearInterval(b(this, H)), C(this, H, void 0)),
        C(this, K, b(this, rt) ? b(this, $) : 0),
        v(this, O, Ct).call(this));
    }),
    (Ct = function () {
      for (; v(this, O, Pt).call(this); );
    }),
    (ur = async function (e) {
      return new Promise((t, n) => {
        e.addEventListener(
          "abort",
          () => {
            n(e.reason);
          },
          { once: !0 },
        );
      });
    }),
    (_t = async function (e, t) {
      return new Promise((n) => {
        const i = () => {
          (t && !t()) || (this.off(e, i), n());
        };
        this.on(e, i);
      });
    }));
  class fn {
    constructor(r) {
      Dt(this, "client");
      Dt(this, "queues", {});
      ((this.options = r),
        (this.client = _.create()),
        z(this.client, {
          retries: (r == null ? void 0 : r.retries) ?? 3,
          retryDelay: (e) => e * 1e3,
        }));
    }
    async download(r, e, t, n = "video/mp4", returnArrayBuffer = false) {
      var o;
      const i = new ln({
          concurrency:
            ((o = this.options) == null ? void 0 : o.concurrency) ?? 8,
        }),
        a = Math.floor(1e7 + Math.random() * 9e7);
      ((this.queues[a] = i), e(a));
      const u = await this.client(r),
        m = new en();
      (m.push(u.data), m.end());
      const c = [];
      let f = null;
      function h(d) {
        return d.startsWith("http") ? d : new URL(d, u.config.url).href;
      }
      m.manifest.segments.forEach((d) => {
        (d.map && d.map.uri !== f && (c.push(h(d.map.uri)), (f = d.map.uri)),
          c.push(h(d.uri)));
      });
      const R = c.map(
        (d) => async () =>
          (await this.client(d, { responseType: "arraybuffer" })).data,
      );
      if (t) {
        let d = 0;
        (i.on("completed", () => {
          const y = Math.floor((1 - (i.size + i.pending) / c.length) * 100);
          y > d && ((d = y), t == null || t(y));
        }),
          i.on("idle", () => {
            d < 100 && (t == null || t(100));
          }));
      }
      const T = await i.addAll(R);
      if (returnArrayBuffer) {
        let totalLen = 0;
        for (const ab of T) totalLen += ab.byteLength;
        const out = new Uint8Array(totalLen);
        let offset = 0;
        for (const ab of T) {
          out.set(new Uint8Array(ab), offset);
          offset += ab.byteLength;
        }
        return out.buffer;
      }
      const E = new Blob(T, { type: n });
      return URL.createObjectURL(E);
    }
    async pause(r) {
      var e;
      (e = this.queues[r]) == null || e.pause();
    }
    async resume(r) {
      var e;
      (e = this.queues[r]) == null || e.start();
    }
    async cancel(r) {
      var e;
      (e = this.queues[r]) == null || e.clear();
    }
  }
  return fn;
});
