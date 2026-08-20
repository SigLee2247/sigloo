# 공개 Release 점검표

- [ ] secret scanner와 Git history에서 token/password/private key가 없는지 확인
- [ ] fixture의 credential은 가짜 값인지 확인
- [ ] 공개 가능한 license와 저작권 고지를 확정
- [ ] 제3자 dependency·font·icon·image license 확인
- [ ] SECURITY.md의 비공개 신고 채널 확정
- [ ] Browser Auth Profile import 경계 확인
- [ ] Process Space가 OS sandbox가 아니라는 문구 유지
- [ ] Desktop offscreen·clipboard·native dialog 정책 확인
- [ ] `npm test`, `npm run check`, `npm run release:gate:all` 실행
