export default {
  async fetch(request) {
    return new Response("ok", {
      headers: {
        "content-type": "text/plain; charset=utf-8"
      }
    });
  }
};
