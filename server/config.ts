const dev = process.env.NODE_ENV !== "production";

export const serverConfig = {
  dev,
  hostname: process.env.HOST || (dev ? "127.0.0.1" : "0.0.0.0"),
  port: Number(process.env.PORT || "3000"),
};
