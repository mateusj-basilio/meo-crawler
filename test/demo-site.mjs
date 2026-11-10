import http from 'node:http';
const server=http.createServer((req,res)=>{
 if(req.url==='/robots.txt'){res.end('User-agent: *\nDisallow: /secret');return;}
 if(req.url==='/sitemap.xml'){res.writeHead(404);res.end();return;}
 if(req.url==='/missing'){res.writeHead(404);res.end('Not found');return;}
 if(req.url==='/redirect'){res.writeHead(301,{location:'/produto'});res.end();return;}
 if(req.url==='/imagem.svg'){res.setHeader('content-type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="green"/></svg>');return;}
 res.setHeader('content-type','text/html');
 res.end(`<!doctype html><html lang="pt-BR"><head><title>${req.url==='/'?'Laboratório SEO — Loja demonstração':'Produto SEO — Demonstração'}</title><meta name="description" content="Uma loja local criada para validar rastreamento e auditoria sem consultar sites externos."></head><body><h1>Laboratório SEO</h1><p>Este é um teste local com links, imagens e redirecionamentos.</p>${req.url==='/'?'<a href="/produto">Produto</a><a href="/missing">Link quebrado</a><a href="/secret">Bloqueado</a><a href="/redirect">Redirecionamento</a><img src="/imagem.svg">':'<a href="/">Início</a>'}</body></html>`);
});
server.listen(4319,'127.0.0.1',()=>console.log('Fixture local http://127.0.0.1:4319'));
