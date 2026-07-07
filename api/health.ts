export default function handler(
  _request: { method?: string },
  response: { status: (code: number) => { json: (body: unknown) => void } }
) {
  response.status(200).json({
    ok: true
  });
}
