export function getApiErrorDetail(error, fallback = "Something went wrong.") {
    return error?.response?.data?.detail ?? fallback;
}