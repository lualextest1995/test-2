import axios from 'axios'
import type {
  AxiosInstance,
  AxiosError,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios'

// 定義請求攔截器的類型
interface RequestInterceptors {
  requestInterceptor?: (config: InternalAxiosRequestConfig) => InternalAxiosRequestConfig
  requestInterceptorCatch?: (error: AxiosError) => any
  responseInterceptor?: (response: AxiosResponse) => any
  responseInterceptorCatch?: (error: unknown) => any
}

// 擴充 AxiosRequestConfig 介面
interface RequestConfig extends AxiosRequestConfig {
  interceptors?: RequestInterceptors
  retry?: number
}

// 自訂錯誤類型
interface CustomError {
  isHandled?: boolean
  canceled?: boolean
  code?: number
  message?: string
  raw?: any
}

// 自訂延遲函數
function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

class Request {
  instance: AxiosInstance
  interceptors?: RequestInterceptors
  abortControllerMap: Map<string, AbortController>

  constructor(config: RequestConfig) {
    this.instance = axios.create(config)
    this.interceptors = config.interceptors
    this.abortControllerMap = new Map()

    // 攔截器處理順序（Axios 機制）：
    // 請求階段：
    //   1. 自訂 requestInterceptor
    //   2. 全局 defaultRequestInterceptor
    // 響應階段：
    //   1. 自訂 responseInterceptor
    //   2. 全局 defaultResponseInterceptor

    // 全局請求攔截器
    this.instance.interceptors.request.use(
      this.defaultRequestInterceptor,
      this.defaultRequestInterceptorCatch,
    )

    //自訂請求攔截
    // requestInterceptor 必須回傳 config，否則後續全局攔截器會報錯
    // requestInterceptorCatch 必須回傳 Promise.reject(error)，否則後續全局攔截器會報錯
    this.instance.interceptors.request.use(
      this.interceptors?.requestInterceptor,
      this.interceptors?.requestInterceptorCatch,
    )

    // 自訂響應攔截
    // responseInterceptor 必須回傳 response，否則後續全局攔截器會報錯
    // responseInterceptorCatch 必須回傳 Promise.reject(error)，否則後續全局攔截器會報錯
    this.instance.interceptors.response.use(
      this.interceptors?.responseInterceptor,
      this.interceptors?.responseInterceptorCatch,
    )

    // 全局響應攔截器
    this.instance.interceptors.response.use(
      this.defaultResponseInterceptor,
      this.defaultResponseInterceptorCatch,
    )
  }

  /**
   * 預設的 Axios 請求攔截器。
   * @param config - 要攔截的 Axios 請求配置對象。
   * @returns 修改後或原始的 Axios 請求配置對象。
   */
  private defaultRequestInterceptor = (config: InternalAxiosRequestConfig) => {
    // 檢查網路連線狀態
    if (!navigator.onLine) {
      alert('網路連線異常，請檢查網路設定')
      return Promise.reject(new Error('網路連線異常，請檢查網路設定'))
    }

    const controller = new AbortController()
    const { signal } = controller
    config.signal = signal
    const key = this.getRequestKey(config)
    this.abortControllerMap.set(key, controller)

    // 處理 method 是 GET 的請求，將 config 裡面的 data 轉換成 query string
    if (config.method?.toLowerCase() === 'get' && config.data) {
      const params = new URLSearchParams()
      Object.keys(config.data).forEach((key) => {
        params.append(key, config.data[key])
      })
      config.params = params
      delete config.data
    }

    console.log('全局請求攔截', config)
    return config
  }

  /**
   * 預設的 Axios 請求攔截錯誤處理器。
   * @param error - 要處理的 Axios 錯誤對象。
   * @returns 拒絕的 Promise，攔截錯誤。
   */
  private defaultRequestInterceptorCatch = (error: AxiosError) => {
    console.log('全局請求攔截錯誤')
    return Promise.reject(error)
  }

  /**
   * 預設的 Axios 響應攔截器。
   * @param response - 要攔截的 Axios 響應對象。
   * @returns 修改後或原始的 Axios 響應數據。
   */
  private defaultResponseInterceptor = (response: AxiosResponse) => {
    const key = this.getRequestKey(response.config)
    this.abortControllerMap.delete(key)

    // 判斷是否是文件下載，如果是直接返回 response
    const type = Object.prototype.toString.call(response.data)
    const isBlob = response.config.responseType === 'blob' || type === '[object Blob]'
    const isArrayBuffer =
      response.config.responseType === 'arraybuffer' || type === '[object ArrayBuffer]'
    if (isBlob || isArrayBuffer) {
      return response
    }

    console.log('全局響應攔截', response)
    return response.data
  }

  /**
   * 預設的 Axios 響應攔截錯誤處理器。
   * @param error - 要處理的 Axios 錯誤對象。
   * @returns 拒絕的 Promise，攔截錯誤。
   */
  private defaultResponseInterceptorCatch = async (error: unknown) => {
    // 取消請求的錯誤處理
    if (axios.isCancel(error)) {
      return Promise.reject({ canceled: true, message: error.message })
    }

    // 處理 Blob 響應錯誤
    const parsed = await this.parseBlobError(error)
    if (parsed) {
      alert(parsed.message)
      return Promise.reject(parsed)
    }

    // 處理 500 / 401 / 403 / 404 等錯誤
    if (axios.isAxiosError(error)) {
      return this.handleAxiosError(error)
    }

    console.log('未知錯誤或非 Axios 錯誤：', error)
    return Promise.reject(error)
  }

  /**
   * 產生唯一的請求 key，基於 method + url。
   * @param config - Axios 請求配置。
   * @returns 字串格式為 `${method}:${url}`。
   */
  private getRequestKey(config: { method?: string; url?: string }) {
    return `${config.method?.toLowerCase()}:${config.url}`
  }

  /**
   * 處理 Axios 錯誤，並顯示對應的錯誤訊息。
   * @param error - 要處理的 Axios 錯誤對象。
   * @returns 拒絕的 Promise，攔截錯誤。
   */
  private handleAxiosError(error: AxiosError) {
    const codeMap = new Map([
      [500, '伺服器錯誤'],
      [401, '未授權'],
      [403, '禁止訪問'],
      [404, '找不到資源'],
      [429, '請求過於頻繁，請稍後再試'],
    ])
    const message = codeMap.get(error.response?.status ?? 0)
    if (message) {
      alert(message)
      return Promise.reject({ code: error.response?.status, message, isHandled: true })
    }
    return Promise.reject(error)
  }

  /**
   * 解析 Blob 響應錯誤，並返回可讀的錯誤訊息。
   * @param error - 要解析的錯誤對象。
   * @returns 解析後的錯誤訊息或 undefined。
   */
  private async parseBlobError(error: unknown): Promise<CustomError | undefined> {
    if (axios.isAxiosError(error) && error.response?.data instanceof Blob) {
      const blob = error.response.data
      const mime = blob.type
      const text = await blob.text()

      if (mime.includes('application/json')) {
        try {
          const json = JSON.parse(text)
          return {
            isHandled: true,
            message: json.message || json.msg || '未知錯誤',
            raw: json,
          }
        } catch {
          return {
            isHandled: true,
            message: 'JSON 格式錯誤',
            raw: text,
          }
        }
      }

      if (mime.includes('text/html') || mime.includes('text/plain')) {
        return {
          isHandled: true,
          message: text.slice(0, 100), // 預防過長
          raw: text,
        }
      }

      return {
        isHandled: true,
        message: '未知的錯誤格式',
        raw: text,
      }
    }

    return undefined
  }

  /**
   * 取消所有請求。
   * @description 這個方法會遍歷所有的 AbortController，並調用它們的 abort 方法來取消請求。
   */
  cancelAllRequests() {
    this.abortControllerMap.forEach((controller) => {
      controller.abort()
    })
    this.abortControllerMap.clear()
    console.log('取消所有請求')
  }

  /**
   * 取消指定的請求。
   * @param key - 要取消的請求的 key 或 key 陣列，規則是 `${method}:${url}`。
   */
  cancelRequest(key: string | string[]) {
    const keys = Array.isArray(key) ? key : [key]
    keys.forEach((key) => {
      const controller = this.abortControllerMap.get(key)
      if (controller) {
        controller.abort()
        this.abortControllerMap.delete(key)
        console.log(`取消請求: ${key}`)
      }
    })
  }

  /**
   * 發送 HTTP 請求，並自動套用所有攔截器。
   * @param config - Axios 請求配置對象，支援自訂攔截器。
   * @returns Axios 響應對象的 Promise。
   */
  async http(config: RequestConfig) {
    const { retry = 0 } = config
    let retriesLeft = retry

    while (true) {
      try {
        return await this.instance.request(config)
      } catch (error: unknown) {
        const { isHandled, canceled } = error as CustomError
        if (retriesLeft > 0 && !canceled && !isHandled) {
          retriesLeft--
          console.warn(`重試中... 剩餘次數 ${retriesLeft}`)
          await delay(1000) // 延遲 1 秒後重試
          continue
        }
        throw error
      }
    }
  }
}

export default Request
