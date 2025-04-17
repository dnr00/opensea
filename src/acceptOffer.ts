import { ethers } from 'ethers';
import { FordefiWeb3Provider, FordefiProviderConfig, EvmChainId } from "@fordefi/web3-provider";
import { OpenSeaSDK, Chain, OrderSide } from 'opensea-js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

/**
 * 환경 변수 및 설정 값
 */
const NFT_CONTRACT_ADDRESS = '0x9c451e5f05c03cefc30404dfd193788799c58c7a'; // NFT 컨트랙트 주소
const NFT_TOKEN_ID = '41'; // NFT 토큰 ID
const ORDER_HASH = ''; // 특정 오퍼의 해시값 (선택적, 비워두면 자동으로 최고가 오퍼 선택)
const PEM_KEY_PATH = '/Users/sangwook/workspace/typescript/opensea/private.pem';

/**
 * Fordefi Provider 설정 및 초기화
 */
class FordefiProviderManager {
  provider: FordefiWeb3Provider;
  ethersProvider: ethers.BrowserProvider | ethers.JsonRpcProvider;
  signer: ethers.Signer;
  walletAddress: string;
  chainId?: string;
  code?: number;
  message?: string;
  
  constructor() {
    const pemKey = fs.readFileSync(PEM_KEY_PATH, 'utf8') ?? 
      (() => { throw new Error('PEM 키를 읽을 수 없습니다') })();
    
    const config: FordefiProviderConfig = {
      chainId: EvmChainId.NUMBER_8453, // Base
      address: "0x2A7fb76E6EC0a3b329Ac3AB94dBdbAB2F0cC5c8e",
      apiUserToken: process.env.FORDEFI_API_USER_TOKEN!,
      apiPayloadSignKey: pemKey,
      rpcUrl: "https://base-mainnet.g.alchemy.com/v2/sA2ayOK8MT4fMosd38djWYYseUK8toHM"
    };
    
    this.walletAddress = config.address;
    this.provider = new FordefiWeb3Provider(config);
    
    // ethers v6 변경사항 반영
    this.ethersProvider = new ethers.BrowserProvider(this.provider as any);
    this.signer = this.ethersProvider.getSigner() as unknown as ethers.Signer;
  }
  
  /**
   * EIP-1193 이벤트 등록 및 Provider 연결
   */
  async connect() {
    console.log("Fordefi Provider에 연결 중...");
    
    // 체인 변경 이벤트 핸들링
    this.provider.on("chainChanged", (chainId: string) => {
      console.log("체인 변경됨:", chainId);
    });
    
    // 계정 변경 이벤트 핸들링
    this.provider.on("accountsChanged", (accounts: string[]) => {
      console.log("계정 변경됨:", accounts[0]);
    });
    
    // 연결 이벤트 핸들링
    this.provider.on("connect", ({ chainId }) => {
      console.log("Provider 연결됨, 체인 ID:", chainId);
    });
    
    // 연결 해제 이벤트 핸들링
    this.provider.on("disconnect", (error: { code: number; message: string }) => {
      this.code = error.code;
      this.message = error.message;
      console.log("Provider 연결 해제됨:", error.message);
    });
    
    try {
      // Provider 연결 요청
      await this.provider.request({ method: "eth_requestAccounts" });
      
      // 연결된 체인 ID 확인
      const chainId = await this.provider.request({ method: "eth_chainId" });
      this.chainId = chainId;
      
      // 현재 계정 가져오기
      const accounts = await this.provider.request({ method: "eth_accounts" });
      const account = accounts[0];
      
      // Signer 업데이트
      this.signer = await this.ethersProvider.getSigner();
      
      console.log("Fordefi Provider에 성공적으로 연결됨");
      console.log("사용 중인 지갑 주소:", account);
      
      return this.signer;
    } catch (error: any) {
      console.error("Fordefi Provider 연결 중 오류 발생:", error.message || error);
      throw error;
    }
  }
  
  /**
   * Provider 연결 해제
   */
  async disconnect() {
    await this.provider.disconnect();
    console.log("Fordefi Provider 연결 해제됨");
  }
}

/**
 * OpenSea NFT 오퍼 수락 관리 클래스
 */
class OpenSeaOfferAcceptor {
  openseaSDK: OpenSeaSDK;
  signer: ethers.Signer;
  walletAddress: string;
  ethersProvider: ethers.BrowserProvider | ethers.JsonRpcProvider;
  
  constructor(signer: ethers.Signer, walletAddress: string, ethersProvider: ethers.BrowserProvider | ethers.JsonRpcProvider) {
    this.signer = signer;
    this.walletAddress = walletAddress;
    this.ethersProvider = ethersProvider;
    
    // OpenSea SDK 초기화
    this.openseaSDK = new OpenSeaSDK(signer as any, {
      chain: Chain.Base,
      apiKey: process.env.OPENSEA_API_KEY!,
    });
  }
  
  /**
   * OpenSea에 ERC1155 승인
   */
  async approveERC1155ForOpenSea(tokenAddress: string) {
    try {
      console.log(`OpenSea에 ERC1155 승인 요청 중...`);
      
      // ERC1155 기본 인터페이스
      const erc1155Interface = [
        'function setApprovalForAll(address operator, bool approved) external',
        'function isApprovedForAll(address account, address operator) view returns (bool)'
      ];
      
      const nftContract = new ethers.Contract(tokenAddress, erc1155Interface, this.signer);
      
      // Base Chain의 Seaport 주소 
      const seaportAddress = '0x0000000000000068f116a894984e2db1123eb395';
      
      // 승인 상태 확인
      const isApproved = await nftContract.isApprovedForAll(this.walletAddress, seaportAddress);
      
      if (isApproved) {
        console.log('이미 OpenSea에 승인되어 있습니다.');
        return true;
      }
      
      console.log('OpenSea에 승인 요청 중...');
      const tx = await nftContract.setApprovalForAll(seaportAddress, true);
      console.log('승인 트랜잭션 전송됨:', tx.hash);
      
      console.log('트랜잭션 확인 중...');
      await tx.wait();
      console.log('OpenSea에 승인 완료!');
      
      return true;
    } catch (error: any) {
      console.error('OpenSea 승인 중 오류 발생:', error.message || error);
      throw error;
    }
  }
  
  /**
   * NFT 소유권 확인
   */
  async verifyOwnership(tokenAddress: string, tokenId: string) {
    try {
      console.log(`NFT 소유권 확인 중: ${tokenAddress} #${tokenId}`);
      
      // ERC1155 기본 인터페이스
      const erc1155Interface = [
        'function balanceOf(address account, uint256 id) view returns (uint256)',
        'function isApprovedForAll(address account, address operator) view returns (bool)'
      ];
      
      const nftContract = new ethers.Contract(tokenAddress, erc1155Interface, this.signer);
      
      // 소유한 토큰 수량 확인
      const balance = await nftContract.balanceOf(this.walletAddress, tokenId);
      const hasTokens = balance.toString() !== '0';
      
      console.log(`NFT 보유량: ${balance.toString()}`);
      
      if (!hasTokens) {
        throw new Error(`해당 NFT를 소유하고 있지 않습니다. 보유량: 0`);
      }
      
      // OpenSea 컨트랙트 승인 확인
      // Base Seaport 주소
      const seaportAddress = '0x0000000000000068f116a894984e2db1123eb395';
      try {
        const isApproved = await nftContract.isApprovedForAll(
          this.walletAddress, 
          seaportAddress
        );
        
        console.log(`OpenSea 승인 상태: ${isApproved ? '승인됨' : '승인 필요'}`);
        
        if (!isApproved) {
          console.log('경고: OpenSea에 대한 승인이 되어있지 않습니다. 승인 절차가 필요합니다.');
          // 자동 승인 실행
          console.log('자동으로 OpenSea 승인을 진행합니다...');
          await this.approveERC1155ForOpenSea(tokenAddress);
        }
      } catch (approvalError: unknown) {
        console.log('OpenSea 승인 상태 확인 실패:', approvalError as Error);
      }
      
      return true;
    } catch (error: any) {
      console.error('NFT 소유권 확인 중 오류 발생:', error.message || error);
      throw error;
    }
  }

  /**
   * NFT에 대한 최고가 오퍼 가져오기
   */
  async getBestOffer(tokenAddress: string, tokenId: string, orderHash?: string) {
    try {
      console.log(`${tokenAddress} 컨트랙트의 토큰 ID ${tokenId}에 대한 오퍼 조회 중...`);
      
      // 특정 오퍼 해시가 제공된 경우
      if (orderHash && orderHash.trim() !== '') {
        console.log(`특정 오퍼 해시로 조회: ${orderHash}`);
        // any 타입을 사용하여 타입 오류 우회
        const options: any = {
          side: OrderSide.OFFER
        };
        
        // API 문서에 따라 적절한 파라미터 이름 사용
        options.orderHash = orderHash;
        
        const order = await this.openseaSDK.api.getOrder(options);
        
        if (!order) {
          throw new Error(`해당 해시(${orderHash})의 오퍼를 찾을 수 없습니다.`);
        }
        
        console.log('오퍼 찾음:', order);
        return order;
      }
      
      // 모든 오퍼 가져오기
      console.log('모든 오퍼 조회 중...');
      const queryOptions: any = {
        assetContractAddress: tokenAddress,
        tokenId,
        side: OrderSide.OFFER,
        limit: 50,
      };
      
      const { orders } = await this.openseaSDK.api.getOrders(queryOptions);
      
      // 오퍼가 없는 경우
      if (!orders || orders.length === 0) {
        console.log('오퍼가 없습니다.');
        return null;
      }
      
      // 첫 번째 오퍼의 전체 구조 출력 (디버깅용)
      if (orders.length > 0) {
        console.log('첫 번째 오퍼 구조 분석:');
        console.log('- orderHash:', orders[0].orderHash);
        console.log('- maker:', orders[0].maker?.address);
        console.log('- currentPrice:', ethers.formatEther(orders[0].currentPrice));
        
        // protocolData 구조 확인
        if (orders[0].protocolData && orders[0].protocolData.parameters) {
          console.log('- parameters.offer 구조:');
          console.log(JSON.stringify(orders[0].protocolData.parameters.offer, null, 2));
        }
      }
      
      // ERC1155 토큰의 경우 필터링 없이 모든 오퍼 사용
      console.log(`총 ${orders.length}개의 오퍼를 가져왔습니다.`);
      
      // 가격 기준으로 수동 정렬 (내림차순)
      const sortedOrders = [...orders].sort((a, b) => {
        const priceA = BigInt(a.currentPrice.toString());
        const priceB = BigInt(b.currentPrice.toString());
        return priceB > priceA ? 1 : priceB < priceA ? -1 : 0; // 내림차순
      });
      
      // 최고가 오퍼 선택
      const bestOffer = sortedOrders[0];
      console.log(`최고가 오퍼 찾음: ${ethers.formatEther(bestOffer.currentPrice)} ETH (${bestOffer.currentPrice})`);
      
      console.log('오퍼 상세 정보:', bestOffer);
      return bestOffer;
    } catch (error: any) {
      console.error('오퍼 조회 중 오류 발생:', error.message || error);
      throw error;
    }
  }
  
  /**
   * 오퍼에서 토큰 ID 추출
   */
  getTokenIdFromOrder(order: any): string {
    try {
      // order 객체 내부 구조 탐색
      if (order.protocolData && order.protocolData.parameters && order.protocolData.parameters.offer) {
        // offer 배열의 첫 번째 항목 확인
        const offerItems = order.protocolData.parameters.offer;
        for (const item of offerItems) {
          if (item.identifierOrCriteria) {
            return item.identifierOrCriteria;
          }
        }
      }
      
      // 대체 경로 탐색
      if (order.protocol_data && order.protocol_data.parameters && order.protocol_data.parameters.offer) {
        const offerItems = order.protocol_data.parameters.offer;
        for (const item of offerItems) {
          if (item.identifierOrCriteria) {
            return item.identifierOrCriteria;
          }
        }
      }
      
      console.log('경고: 오퍼에서 토큰 ID를 찾을 수 없습니다.');
      return '';
    } catch (error) {
      console.error('토큰 ID 추출 중 오류 발생:', error);
      return '';
    }
  }
  
  /**
   * NFT 오퍼 수락
   */
  async acceptOffer(tokenAddress: string, tokenId: string, orderHash?: string) {
    try {
      console.log('NFT 오퍼 수락 프로세스 시작...');
      
      // 1. NFT 소유권 확인
      await this.verifyOwnership(tokenAddress, tokenId);
      
      // 2. 최고가 오퍼 찾기
      const order = await this.getBestOffer(tokenAddress, tokenId, orderHash);
      if (!order) {
        throw new Error('수락할 오퍼를 찾을 수 없습니다.');
      }
      
      // 3. 오퍼 상세 정보 출력
      console.log('오퍼 수락 전 상세 정보:');
      console.log(`- 오퍼 해시: ${order.orderHash}`);
      console.log(`- 가격: ${ethers.formatEther(order.currentPrice)} ETH`);
      console.log(`- 구매자: ${order.maker.address}`);
      console.log(`- 프로토콜: ${order.protocolAddress}`);
      console.log(`- 만료일: ${order.closingDate}`);
      
      // 사용자 확인 단계 (실제 구현에서는 사용자 UI/UX에 맞게 수정 필요)
      console.log(`\n해당 오퍼를 수락하시겠습니까? 이 과정은 구매자(${order.maker.address})가 가스비를 지불합니다.`);
      
      // 4. 오퍼 수락
      console.log('오퍼 수락 중...');
      
      // fulfillOrder 함수 호출 (판매자로서 오퍼 수락)
      const fulfillResponse: any = await this.openseaSDK.fulfillOrder({ 
        order, 
        accountAddress: this.walletAddress,
        recipientAddress: order.maker.address  // 구매자 주소
      });
      
      console.log('오퍼 수락 성공!');
      console.log('트랜잭션 결과:', fulfillResponse);
      
      // 트랜잭션 해시 처리 (객체 또는 문자열이 될 수 있음)
      let txHash = 'Unknown hash';
      if (typeof fulfillResponse === 'string') {
        txHash = fulfillResponse;
      } else if (fulfillResponse && typeof fulfillResponse === 'object') {
        txHash = fulfillResponse.hash || fulfillResponse.transactionHash || 'Unknown hash';
      }
      
      console.log('트랜잭션 해시:', txHash);
      
      return fulfillResponse;
    } catch (error: any) {
      console.error('오퍼 수락 중 오류 발생:', error.message || error);
      throw error;
    }
  }
}

/**
 * 메인 함수: NFT 오퍼 수락 프로세스
 */
async function acceptNFTOffer() {
  const fordefiManager = new FordefiProviderManager();
  
  try {
    // 1. Fordefi Provider 연결
    const signer = await fordefiManager.connect();
    
    // 2. OpenSea 오퍼 수락 매니저 초기화
    const acceptor = new OpenSeaOfferAcceptor(signer, fordefiManager.walletAddress, fordefiManager.ethersProvider);
    
    // 3. NFT 오퍼 수락
    await acceptor.acceptOffer(
      NFT_CONTRACT_ADDRESS,
      NFT_TOKEN_ID,
      ORDER_HASH
    );
    
    console.log('NFT 오퍼 수락 프로세스가 성공적으로 완료되었습니다!');
  } catch (error: any) {
    // 오류 처리
    if (error?.message?.includes('소유하고 있지 않습니다')) {
      console.error('소유권 오류:', error.message);
      console.log('다음을 확인해보세요:');
      console.log('1. NFT의 토큰 ID가 올바른지');
      console.log('2. NFT의 컨트랙트 주소가 올바른지');
      console.log('3. 해당 NFT를 지갑에서 소유하고 있는지');
    } else if (error?.message?.includes('오퍼가 없습니다')) {
      console.error('오퍼 오류:', error.message);
      console.log('해당 NFT에 대한 오퍼가 없습니다.');
    } else {
      console.error('오류 발생:', error.message || error);
    }
  } finally {
    // 항상 Provider 연결 해제
    await fordefiManager.disconnect();
  }
}

// NFT 오퍼 수락 함수 실행
acceptNFTOffer();
