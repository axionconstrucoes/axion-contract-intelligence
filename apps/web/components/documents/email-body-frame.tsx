"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function EmailBodyFrame({
  srcDoc,
}: {
  srcDoc: string;
}) {
  const iframeRef =
    useRef<HTMLIFrameElement>(null);

  const [height, setHeight] =
    useState(300);

  const adjustHeight = useCallback(() => {
    const iframe = iframeRef.current;

    if (!iframe) return;

    try {
      const document =
        iframe.contentDocument;

      if (!document) return;

      const bodyHeight =
        document.body?.scrollHeight ?? 0;

      const htmlHeight =
        document.documentElement?.scrollHeight ?? 0;

      const nextHeight =
        Math.max(
          180,
          bodyHeight,
          htmlHeight
        ) + 12;

      setHeight(nextHeight);
    } catch {
      // Se o documento ainda não estiver pronto,
      // o próximo evento/load fará nova tentativa.
    }
  }, []);

  useEffect(() => {
    const timer1 =
      window.setTimeout(
        adjustHeight,
        50
      );

    const timer2 =
      window.setTimeout(
        adjustHeight,
        300
      );

    const timer3 =
      window.setTimeout(
        adjustHeight,
        1000
      );

    window.addEventListener(
      "resize",
      adjustHeight
    );

    return () => {
      window.clearTimeout(timer1);
      window.clearTimeout(timer2);
      window.clearTimeout(timer3);

      window.removeEventListener(
        "resize",
        adjustHeight
      );
    };
  }, [srcDoc, adjustHeight]);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcDoc}
      title="Corpo do e-mail"
      sandbox="allow-same-origin"
      scrolling="no"
      onLoad={() => {
        adjustHeight();

        window.setTimeout(
          adjustHeight,
          100
        );

        window.setTimeout(
          adjustHeight,
          500
        );
      }}
      style={{
        height: `${height}px`,
      }}
      className="block w-full overflow-hidden border-0 bg-white"
    />
  );
}
