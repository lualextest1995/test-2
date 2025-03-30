import Request from '@/utils/request'

const request = new Request({
  baseURL: 'http://localhost:9527',
  timeout: 10000,
  interceptors: {
    requestInterceptor(config) {
      console.log('請求攔截成功', config)
      config.timeout = 5000
      return config
    },
    responseInterceptor(response) {
      console.log('響應攔截成功', response)
      response.status = 201
      return response
    },
    requestInterceptorCatch(error) {
      console.log('請求攔截失敗', error)
      return Promise.reject(error)
    },
    responseInterceptorCatch(error) {
      console.log('響應攔截失敗', error)
      return Promise.reject(error)
    },
  },
})

export function getData(data: Record<string, string>) {
  return request.http({
    url: '/people',
    method: 'get',
    retry: 3,
    data,
  })
}

export default request
