import type { CSSProperties } from "react";

// A small, client-safe preview of each invoice layout. It recolours live with
// the chosen accent so vendors see what they're picking. Abstract (bars stand
// in for text) but faithful to each template's structure.

const paper: CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 6,
  height: 132,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
};

function Bar({ w, h = 5, c = "#e2e8f0", mt = 5 }: { w: number | string; h?: number; c?: string; mt?: number }) {
  return <div style={{ width: w, height: h, background: c, borderRadius: 2, marginTop: mt }} />;
}

function Rows({ n = 3 }: { n?: number }) {
  const ws = ["78%", "62%", "70%", "54%"];
  return (
    <>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
          <div style={{ width: ws[i % ws.length], height: 5, background: "#eef2f7", borderRadius: 2 }} />
          <div style={{ width: "18%", height: 5, background: "#eef2f7", borderRadius: 2 }} />
        </div>
      ))}
    </>
  );
}

export function TemplateThumb({ id, accent }: { id: string; accent: string }) {
  if (id === "meridian") {
    return (
      <div style={paper}>
        <div style={{ padding: "10px 12px", borderBottom: `3px solid ${accent}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Bar w={46} h={7} c="#0f172a" mt={0} />
          <div style={{ width: 30, height: 8, background: accent, borderRadius: 2 }} />
        </div>
        <div style={{ padding: 12, flex: 1 }}>
          <Rows n={3} />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
            <div style={{ width: 62, height: 12, background: accent, borderRadius: 3 }} />
          </div>
        </div>
      </div>
    );
  }

  if (id === "vertex") {
    return (
      <div style={paper}>
        <div style={{ background: accent, padding: 11, height: 46 }}>
          <Bar w={52} h={7} c="#fff" mt={0} />
          <Bar w={30} h={4} c="rgba(255,255,255,.6)" mt={7} />
        </div>
        <div style={{ padding: 12, flex: 1 }}>
          <Rows n={2} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 10 }}>
            <div style={{ width: 44, height: 16, borderRadius: 4, background: accent, opacity: 0.14 }} />
            <div style={{ width: 46, height: 7, background: accent, borderRadius: 2 }} />
          </div>
        </div>
      </div>
    );
  }

  if (id === "column") {
    return (
      <div style={{ ...paper, flexDirection: "row" }}>
        <div style={{ width: "38%", background: accent, padding: 10, display: "flex", flexDirection: "column" }}>
          <Bar w="80%" h={6} c="#fff" mt={0} />
          <Bar w="60%" h={9} c="rgba(255,255,255,.85)" mt={10} />
          <Bar w="45%" h={4} c="rgba(255,255,255,.55)" mt={8} />
          <div style={{ marginTop: "auto" }}>
            <Bar w="90%" h={4} c="rgba(255,255,255,.5)" mt={4} />
            <Bar w="70%" h={7} c="#fff" mt={6} />
          </div>
        </div>
        <div style={{ flex: 1, padding: 11 }}>
          <Bar w="60%" h={6} c="#0f172a" mt={0} />
          <div style={{ marginTop: 8 }}><Rows n={3} /></div>
        </div>
      </div>
    );
  }

  if (id === "boutique") {
    return (
      <div style={paper}>
        <div style={{ padding: "12px 10px 10px", textAlign: "center", borderBottom: "1px solid #eef0ec" }}>
          <div style={{ width: 44, height: 4, background: "#a8a29e", borderRadius: 2, margin: "0 auto" }} />
          <div style={{ width: 74, height: 9, background: "#1c1917", borderRadius: 2, margin: "7px auto 0" }} />
          <div style={{ width: 26, height: 2, background: accent, margin: "8px auto 0" }} />
        </div>
        <div style={{ padding: "10px 14px", flex: 1 }}>
          <Rows n={3} />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <div style={{ width: 50, height: 6, background: accent, borderRadius: 2 }} />
          </div>
        </div>
      </div>
    );
  }

  // aria (default minimal)
  return (
    <div style={paper}>
      <div style={{ padding: 13, flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <Bar w={42} h={7} c="#0f172a" mt={0} />
            <Bar w={28} h={4} c="#cbd5e1" mt={6} />
          </div>
          <div style={{ width: 36, height: 9, background: accent, borderRadius: 2 }} />
        </div>
        <div style={{ marginTop: 12, borderTop: "1px solid #eef2f7", paddingTop: 8 }}>
          <Rows n={3} />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
          <div style={{ width: 54, height: 8, background: accent, borderRadius: 2 }} />
        </div>
      </div>
    </div>
  );
}
