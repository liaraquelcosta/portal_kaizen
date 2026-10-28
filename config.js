// Endereços das aplicações. Edita aqui sempre que um endereço mudar
// (por exemplo quando a app das Cozinhas for migrada para o servidor novo).
window.PORTAL_CONFIG = {
  grupos: [
    {
      cliente: "Somelos Acabamentos",
      apps: [
        {
          nome: "Gestão de Cozinhas",
          descricao: "Pesagens e receitas — Preparação, Acabamento, Tingimento, Tinturaria de Fio",
          // Servidor novo da Somelos (128.0.0.82)
          url: "http://128.0.0.82:5000",
          icone: "🍳"
        },
        {
          nome: "Lab Data",
          descricao: "Dashboard de Cor (SIGEFA) e Análise de lotes macro",
          url: "http://128.0.0.82:3000",
          icone: "🧪"
        },
        {
          nome: "Somelos Planning",
          descricao: "Planeamento da produção",
          url: "http://128.0.0.82:8000",
          icone: "📅"
        }
      ]
    },
    {
      cliente: "Fibope",
      apps: [
        {
          nome: "Plano Diário",
          descricao: "Plano de produção diário — Transformação e Extrusão",
          url: "https://plano-diario-fibope.netlify.app",
          icone: "📋"
        }
      ]
    }
  ]
};
